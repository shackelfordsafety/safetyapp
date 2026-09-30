/* Incident photos that travel with the document.

   The image bytes live in this device's IndexedDB only
   (incidentPhotoStorage.js); the report's JSON carries metadata. That meant
   a report submitted from one iPad and opened on another (an approver, a
   send-back, a pick-up) printed "Photo unavailable" frames, and after
   Submit deleted the author's blobs, not even the author could get them
   back (audit 2026-09-30, C2).

   Fix: on Submit, copy each photo into the private 'documents' storage
   bucket beside the filed PDFs and record where it went on the photo
   (`storagePath`); on pick-up, fetch back any photo this device doesn't
   have. Storage RLS (supabase/migrations/20260908183637_document_pdf_storage.sql,
   20260909202000_supers_disciplinary_only.sql): you can only write inside
   your own <uid>/ folder, and read your own folder -- or anybody's if you
   are office (pm/hr/owner/safety/clerk). There is no UPDATE or DELETE
   policy, so an upload is permanent and cannot be replaced: that is why
   uploads use upsert:false and a "that file already exists" answer counts
   as success (a retry after a timed-out reply, or a re-submit).

   Nothing here is wired in by itself -- see the exported functions. */

import { getPhotoBlob, savePhotoBlob, notifyPhotoBlobsChanged } from './incidentPhotoStorage';

const BUCKET = 'documents';

export function incidentPhotoStoragePath(userId, incidentId, photoId) {
  return `${userId}/incident-photos/${incidentId}/${photoId}.jpg`;
}

function isAlreadyThere(error) {
  if (!error) return false;
  const status = String(error.statusCode ?? error.status ?? '');
  const text = `${error.error || ''} ${error.message || ''}`;
  return status === '409' || /already exists|duplicate/i.test(text);
}

/* Upload every photo that is on this device and not yet stored.

   Returns a NEW incident object whose uploaded photos carry `storagePath`
   (photos already carrying one, and photos with no blob on this device,
   are passed through untouched). Save that object as the report.

   Throws a readable Error if any photo that IS on this device could not be
   uploaded -- the report must not be submitted as if its photos went with
   it. The thrown error carries `.incident` (the same NEW object, with the
   photos that did make it marked) so a caller can keep that progress; a
   retry re-uploads only what is still missing. */
export async function uploadIncidentPhotos(db, userId, incident) {
  if (!incident || !Array.isArray(incident.photos) || !incident.photos.length) return incident;
  if (!db || !userId) throw new Error("Can't upload the photos: not signed in.");

  const failures = [];
  const photos = [];
  for (const photo of incident.photos) {
    if (!photo || !photo.id || photo.storagePath) { photos.push(photo); continue; }
    let blob;
    try {
      // eslint-disable-next-line no-await-in-loop
      blob = await getPhotoBlob(photo.id);
    } catch (err) {
      failures.push(`couldn't read it on this device (${err?.message || err})`);
      photos.push(photo);
      continue;
    }
    if (!blob) { photos.push(photo); continue; } // not on this device: nothing to send
    const path = incidentPhotoStoragePath(userId, incident.id, photo.id);
    try {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error && !isAlreadyThere(error)) throw error;
      photos.push({ ...photo, storagePath: path });
    } catch (err) {
      failures.push(err?.message || String(err));
      photos.push(photo);
    }
  }

  const next = { ...incident, photos };
  if (failures.length) {
    const n = failures.length;
    const err = new Error(`${n} photo${n === 1 ? '' : 's'} couldn't be uploaded (${failures[0]}). Check the connection and try again.`);
    err.incident = next;
    throw err;
  }
  return next;
}

/* Fetch back every stored photo this device doesn't have. Best-effort:
   never throws. Returns { restored, failed } counts. A photo with no
   storagePath (never uploaded) is not counted either way -- it can only
   come from the device that took it. Open Incident screens pick restored
   photos up by themselves (notifyPhotoBlobsChanged). */
export async function restoreIncidentPhotos(db, incident) {
  let restored = 0;
  let failed = 0;
  const photos = (incident && Array.isArray(incident.photos)) ? incident.photos : [];
  for (const photo of photos) {
    if (!photo || !photo.id || !photo.storagePath) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await getPhotoBlob(photo.id)) continue;
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await db.storage.from(BUCKET).download(photo.storagePath);
      if (error || !data) throw error || new Error('empty download');
      // eslint-disable-next-line no-await-in-loop
      await savePhotoBlob(photo.id, incident.id, data);
      restored += 1;
    } catch {
      failed += 1;
    }
  }
  if (restored) notifyPhotoBlobsChanged();
  return { restored, failed };
}
