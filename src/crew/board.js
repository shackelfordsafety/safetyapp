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

/* What a crew member reads on the board to find his line. Pulled from the
   JSA rather than typed separately -- one less thing to fill in at 6am. */
export function boardLabel(jsa) {
  const task = (jsa?.overallWorkTask || '').trim();
  const site = (jsa?.jobSite || jsa?.location || '').trim();
  if (task && site) return `${task} — ${site}`;
  return task || site || 'Job Safety Analysis';
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
export async function publishToBoard({ jsa, boardOwner }) {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();

  const id = (crypto.randomUUID && crypto.randomUUID())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
    .select('id, area_label, job_site, location, job_number, doc_date, published_at, expires_at, version, data')
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
