import { db } from '../archive/archiveClient';

/* ── The board: publishing a JSA, and crew signing it ────────────────────
   Reached only through dynamic import(), same as the archive, so neither
   this nor the Supabase library it pulls in ever lands in the bundle a
   superintendent downloads to fill out a JSA.

   A superintendent has ONE permanent QR. It does not point at a JSA -- it
   points at his BOARD, which lists every JSA live right now. A job needing
   five JSAs is five rows on one board and one QR.

   Publishing LOCKS a JSA. Revising means publishing a new version; the
   people who signed v1 stay attached to v1 forever. There is no UPDATE or
   DELETE policy on either table, so that is enforced by the database
   rather than by being careful up here. */

export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to publish this to your board.');
    this.name = 'NotSignedInError';
  }
}

/* When the JSA stops being live.

   Uses the JSA's own "Time Expired" field, which is real safety practice:
   a JSA is good for a window, and work past that window needs a new one.

   Two cases worth knowing about:
   - No expiry time set -> end of that day.
   - Expiry EARLIER than the issue time -> the shift runs through midnight
     (6pm to 4am), so it belongs to the next day. Nights are rare here but
     they happen, and a board that vanished at midnight would strand a man
     arriving at 1am with nothing to sign. */
export function computeExpiry(jsa, now = new Date()) {
  const day = jsa?.date || new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
  const end = /^\d{2}:\d{2}$/.test(jsa?.timeExpired || '') ? jsa.timeExpired : null;
  if (!end) return new Date(`${day}T23:59:59`);

  const expires = new Date(`${day}T${end}:00`);
  const start = /^\d{2}:\d{2}$/.test(jsa?.timeIssued || '') ? jsa.timeIssued : null;
  if (start && end <= start) expires.setDate(expires.getDate() + 1);
  return expires;
}

/* What a crew member reads on the board to find his line.

   The AREA leads, not the overall task. A job site can run five JSAs in one
   day and they all share the same overall task ("Mass grading") and the
   same job site -- labelling by task made every line on the board read
   identically, which is exactly the thing a man scanning at 6:30 has to
   tell apart. Reported from the field 2026-09-09 after a real test.

   Falls back to the old task-based label for drafts saved before the area
   field existed, so an old JSA still reads sensibly. */
export function boardLabel(jsa) {
  const area = (jsa?.area || '').trim();
  const task = (jsa?.overallWorkTask || '').trim();
  const site = (jsa?.jobSite || jsa?.location || '').trim();
  if (area && site) return `${area} — ${site}`;
  if (area) return area;
  if (task && site) return `${task} — ${site}`;
  return task || site || 'Job Safety Analysis';
}

/* The JSA's steps/hazards/controls, flattened for reading on a phone.

   A deliberately simpler read than the app's own getContentRows(): that one
   reconciles the two entry styles for PRINT accuracy, with near-duplicate
   matching, and lives in main.jsx which this page must never import (the
   crew page renders instead of the app and should not drag it along).
   Here the job is only "show the man what he is signing", so detailed rows
   win when they exist and the newline summaries are used when they don't.

   Split on newlines because that is exactly how the summary fields are
   stored -- one task per line, hazards and controls positionally matched. */
export function readableRows(jsa) {
  const lines = v => String(v || '').split('\n').map(s => s.trim()).filter(Boolean);
  const detailed = (Array.isArray(jsa?.taskRows) ? jsa.taskRows : [])
    .map(r => ({ step: (r?.step || '').trim(), hazards: (r?.hazards || '').trim(), controls: (r?.controls || '').trim() }))
    .filter(r => r.step || r.hazards || r.controls);
  if (detailed.length) return detailed;

  const steps = lines(jsa?.dailyTasks);
  const haz = lines(jsa?.hazardsSummary);
  const con = lines(jsa?.controlsSummary);
  const n = Math.max(steps.length, haz.length, con.length);
  return Array.from({ length: n }, (_, i) => ({
    step: steps[i] || '', hazards: haz[i] || '', controls: con[i] || '',
  }));
}

async function currentUser() {
  try {
    const { data } = await db.auth.getUser();
    return data?.user || null;
  } catch {
    return null;
  }
}

/* Publishes a JSA to a board. Defaults to the publisher's own board;
   `boardOwner` is what lets a foreman publish onto his superintendent's
   board instead, and it follows him when he switches supers. */
export async function publishToBoard({ jsa, boardOwner, pdfBlob }) {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();

  const id = (crypto.randomUUID && crypto.randomUUID())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  /* Store the JSA as a real PDF alongside the row, so "see the JSA" can
     show the actual document rather than a readable summary of it (Fonzo,
     2026-09-09: "i need the actual PDF to pop up when tapping to see").
     Uploaded into the publisher's own folder, which is what the storage
     policy already allows.

     Deliberately not fatal: if the PDF is missing or the upload fails, the
     JSA still publishes and the crew can still sign it. A board that
     refuses to go up because a file did not upload would be a far worse
     failure at 6am than one without a downloadable copy. */
  let pdfPath = null;
  if (pdfBlob) {
    try {
      const path = `${user.id}/board-${id}.pdf`;
      const { error: upErr } = await db.storage
        .from('documents')
        .upload(path, pdfBlob, { contentType: 'application/pdf', upsert: false });
      if (!upErr) pdfPath = path;
    } catch { /* publishing matters more than the copy */ }
  }

  const { error } = await db.from('jsa_publications').insert({
    id,
    board_owner: boardOwner || user.id,
    published_by: user.id,
    client_doc_id: jsa?.id || null,
    version: 1,
    data: jsa,
    area_label: boardLabel(jsa),
    job_site: jsa?.jobSite || null,
    location: jsa?.location || null,
    job_number: jsa?.jobNumber || null,
    doc_date: jsa?.date || null,
    expires_at: computeExpiry(jsa).toISOString(),
    pdf_path: pdfPath,
  });
  if (error) throw new Error(`Could not publish it: ${error.message}`);

  return { id, boardUrl: boardUrlFor(boardOwner || user.id) };
}

/* The address the QR points at. Permanent -- it's derived from the account,
   so a lost sticker is never lost data: pull it up on screen and let the
   crew scan off the iPad, print a replacement whenever. */
export function boardUrlFor(boardOwnerId) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/sign/${boardOwnerId}`;
}

/* Everything live on one board. Public: a crew member has no account. */
export async function fetchBoard(boardOwnerId) {
  const { data, error } = await db
    .from('jsa_publications')
    .select('id, area_label, job_site, location, job_number, doc_date, published_at, expires_at, version, data, pdf_path')
    .eq('board_owner', boardOwnerId)
    .gt('expires_at', new Date().toISOString())
    .order('published_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/* One crew member signing.

   NOTE the deliberate absence of .select() -- a crew member has no account
   and cannot read signatures back, and Postgres rejects an anonymous
   `insert ... returning` with a message that looks like the insert itself
   was refused. Adding .select() here breaks signing for every real user
   while working fine for anyone signed in, which is the worst kind of bug.

   Late signatures are recorded and flagged, never refused: turning away a
   man at 3:45 for a JSA that expired at 3:30 leaves an unsigned worker on
   the job, which is worse than a signature stamped late. */
export async function signPublication({ publicationId, signerName, signatureData, source = 'phone', expiresAt }) {
  const id = (crypto.randomUUID && crypto.randomUUID())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { error } = await db.from('jsa_signatures').insert({
    id,
    publication_id: publicationId,
    signer_name: source === 'kiosk' ? null : (signerName || '').trim(),
    signature_data: signatureData,
    source,
    is_late: expiresAt ? new Date() > new Date(expiresAt) : false,
  });
  if (error) throw new Error(`Could not record your signature: ${error.message}`);
  return { id };
}

/* The super's own view of how it's going. Requires an account -- crew
   members deliberately cannot read who else signed. */
export async function fetchSignatureCounts(publicationIds) {
  if (!publicationIds?.length) return {};
  const { data, error } = await db
    .from('jsa_signatures')
    .select('publication_id')
    .in('publication_id', publicationIds);
  if (error) throw new Error(error.message);
  return (data || []).reduce((acc, r) => {
    acc[r.publication_id] = (acc[r.publication_id] || 0) + 1;
    return acc;
  }, {});
}

/* Everything on MY board, for the superintendent's own view: live JSAs
   first, plus the ones that already expired today so he can still see what
   happened this morning rather than watching them vanish at their expiry
   time. Requires an account -- this is the office side of the same data
   the crew reads anonymously. */
export async function fetchMyBoard() {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();

  // Back to the start of today, local time, so "this morning's JSAs" stay
  // visible after they expire without dragging in last week's.
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { data, error } = await db
    .from('jsa_publications')
    .select('id, area_label, job_site, location, job_number, doc_date, published_at, expires_at, version, client_doc_id, data, pdf_path')
    .eq('board_owner', user.id)
    .gte('published_at', since.toISOString())
    .order('published_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data || [];
  const counts = await fetchSignatureCounts(rows.map(r => r.id));
  const now = new Date();
  return {
    boardUrl: boardUrlFor(user.id),
    rows: rows.map(r => ({
      ...r,
      signed: counts[r.id] || 0,
      live: new Date(r.expires_at) > now,
    })),
  };
}

/* Who has signed one JSA, for the super checking the list rather than the
   number. Named signatures come from phones; the kiosk records numbered
   ones with no name, which is deliberate and not missing data. */
export async function fetchSigners(publicationId) {
  const { data, error } = await db
    .from('jsa_signatures')
    .select('id, signer_name, source, signed_at, is_late')
    .eq('publication_id', publicationId)
    .order('signed_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}
