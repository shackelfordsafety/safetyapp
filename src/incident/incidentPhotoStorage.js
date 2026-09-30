/* Incident Photo blob storage (IndexedDB).
   Photo metadata (category, caption, dimensions, etc. -- see
   emptyIncidentPhoto() in incidentModel.js) lives inside the incident's own
   JSON in localStorage like every other field, so it autosaves for free.
   The image bytes themselves do NOT -- a handful of modern phone photos
   would blow past realistic localStorage quotas and bloat every future
   read/write of the draft. Those live here instead, one blob per photo id,
   completely separate from both the JSA's storage (sdc.jsa.*) and the
   incident's own localStorage keys (sdc.incident.*) -- see
   incidentStorage.js's own separation note.

   Deliberately a thin, explicit wrapper (not a generic helper library):
   every function name says exactly what it does, every failure is caught
   and turned into a clear rejection rather than an uncaught exception --
   this app has no error boundaries anywhere, so a raw IndexedDB exception
   reaching a live render path would blank the whole app, not just fail one
   photo. */

const DB_NAME = 'sdc-incident-photos-v1';
const DB_VERSION = 1;
const STORE = 'blobs';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  const thisOpen = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('incidentId', 'incidentId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      /* iOS Safari closes IndexedDB connections when the tab has been in
         the background a while. Without this the dead connection stayed
         cached and every photo read/write failed until a full reload. */
      db.onclose = () => { if (dbPromise === thisOpen) dbPromise = null; };
      db.onversionchange = () => { db.close(); if (dbPromise === thisOpen) dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Failed to open photo storage.'));
    request.onblocked = () => reject(new Error('Photo storage is blocked by another open tab.'));
  });
  // If opening ever fails, don't cache the rejected promise forever -- a
  // later retry (e.g. after the user closes another tab) should get a
  // fresh attempt instead of the same permanent rejection.
  dbPromise = thisOpen;
  dbPromise.catch(() => { if (dbPromise === thisOpen) dbPromise = null; });
  return dbPromise;
}

/* Persists one photo's image blob, associated with its incident draft. */
export async function savePhotoBlob(id, incidentId, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, incidentId, blob, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save the photo.'));
  });
}

/* Returns the Blob for a photo id, or null if missing/corrupted -- callers
   render a plain-language placeholder for null rather than treating it as
   fatal (a photo record can outlive its blob if storage was cleared
   externally, e.g. browser "Clear site data"). */
export async function getPhotoBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error || new Error('Failed to load the photo.'));
  });
}

export async function deletePhotoBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete the photo.'));
  });
}

/* Deletes every blob belonging to one incident draft -- called when that
   draft is discarded/replaced (single-draft-slot model, see
   resetIncidentToBlank() in main.jsx) so photo blobs never orphan
   themselves in IndexedDB after their owning report is gone. */
export async function deletePhotosForIncident(incidentId) {
  if (!incidentId) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const index = tx.objectStore(STORE).index('incidentId');
    const req = index.openCursor(IDBKeyRange.only(incidentId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    req.onerror = () => reject(req.error || new Error('Failed to clean up photos for the discarded draft.'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clean up photos for the discarded draft.'));
  });
}

/* Tiny change signal for blobs written from outside the Photos step (e.g.
   restoreIncidentPhotos in incidentPhotoCloud.js fetching a picked-up
   report's photos back). useIncidentPhotoUrls listens and retries any
   photo it had already given up on as missing. */
const blobListeners = new Set();

export function onPhotoBlobsChanged(listener) {
  blobListeners.add(listener);
  return () => blobListeners.delete(listener);
}

export function notifyPhotoBlobsChanged() {
  blobListeners.forEach((listener) => {
    try { listener(); } catch { /* a listener must never break the caller */ }
  });
}
