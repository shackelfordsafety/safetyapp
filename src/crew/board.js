import { db } from '../archive/archiveClient';
import { blockInDemo } from '../shared/demoMode';

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

/* How long a posting will stay open, in hours. The number that would have
   caught the 5:00 PM / 5:00 AM mix-up: a night shift is ten hours, the
   typo was twenty-five, and nothing Shackelford runs is in between. */
export function windowHours(jsa, now = new Date()) {
  const ms = computeExpiry(jsa, now).getTime() - now.getTime();
  return Math.max(0, ms / 3600000);
}

/* Anything past this is almost certainly a typed time, not a real shift.
   Deliberately generous -- a genuine long day should never nag. */
export const LONG_WINDOW_HOURS = 16;

/* "5:00 AM Thu · 10 hours".

   The board used to say only "good until 5:00 PM", which reads like this
   afternoon and was in fact 5:00 PM TOMORROW -- so the one detail that
   would have made a 25-hour window obvious was the detail it left out.
   Day and length now always show. */
export function describeWindow(expiresAt, from = new Date()) {
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return '';
  const time = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = end.toDateString() === from.toDateString();
  const day = sameDay ? '' : ` ${end.toLocaleDateString([], { weekday: 'short' })}`;
  const hours = Math.round(Math.max(0, end.getTime() - from.getTime()) / 3600000);
  return `${time}${day} · ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
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

/* What a crew member reads, and it is the SAME function the printed
   form uses -- see src/jsa/jsaContent.js.

   There used to be two here: readableRows, which zipped the three lists
   together by position and invented pairings, and readableColumns, which
   kept its own near-copy of the merge logic. The copy had drifted and
   dropped summary hazards whenever a JSA carried task rows, so a man could
   sign on his phone a JSA missing a hazard the paper carried. readableRows
   had no callers left at all. Both deleted rather than repaired: a copy is
   how they came apart in the first place. */
export { getContentColumns as readableColumns } from '../jsa/jsaContent';

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
  blockInDemo(`Publishing to the board`);
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

/* One board, as a crew member sees it. Public: he has no account.

   Includes JSAs that have already expired today, marked closed. A board
   that empties itself at the expiry minute recreates the exact problem
   this feature exists to solve -- Fonzo's scenario is a client or a safety
   inspector stopping one of his guys and asking to see the JSA, and
   "nothing published yet" at 4pm is the worst possible answer. Anything
   that was live at any point today stays readable for the rest of it. */
/* Goes through board_for() rather than reading the table. A crew member
   has no account, so this call is anonymous -- and an anonymous read of
   jsa_publications used to be allowed for EVERY row, which meant the key
   that ships in this page could list every JSA the company had ever
   published. The board is a lookup now: name the board you want and get
   that one. Nothing changes for a man scanning, because the QR already
   carries whose board it is.

   The function caps its own window at 36 hours so the link cannot be used
   to walk a superintendent's history; the local-midnight filter below is
   still applied here, where the device's own clock and timezone are. */
export async function fetchBoard(boardOwnerId) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { data, error } = await db.rpc('board_for', { owner: boardOwnerId });
  if (error) throw new Error(error.message);

  const now = new Date();
  return (data || [])
    .filter(r => new Date(r.expires_at) > since)
    .map((r) => {
      const live = new Date(r.expires_at) > now;
      return { ...r, live, status: boardStatus(r, live, now), startsAt: startTimeOf(r) };
    })
    /* Open first, then the ones about to start, then the closed ones last.
       A man at 6:30 should find his line at the top of the list, not below
       yesterday's night shift. */
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || new Date(a.published_at) - new Date(b.published_at));
}

const STATUS_ORDER = { open: 0, upcoming: 1, closed: 2 };

/* When this JSA's shift starts, from the day and Time Issued on the
   document itself. Null when there is no usable time, in which case it is
   simply treated as already started -- guessing would be worse. */
function startTimeOf(row) {
  const day = row?.doc_date || row?.data?.date;
  const start = row?.data?.timeIssued;
  if (!day || !/^\d{2}:\d{2}$/.test(start || '')) return null;
  const at = new Date(`${day}T${start}:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/* Three states, and only three, because a crew member should be able to
   tell at a glance which line is his:

     open     - signable now
     upcoming - published, but the shift hasn't started yet
     closed   - past Time Expired; still readable, can't be signed

   "upcoming" is a LABEL, not a lock. Fonzo publishes before the tailgate
   meeting on purpose and is happy for men to read and sign early -- they
   see the whole document and acknowledge it either way, which is the point
   of the thing. So this tells a man the shift hasn't started; it never
   stops him signing. */
export function boardStatus(row, live, now = new Date()) {
  if (!live) return 'closed';
  const start = startTimeOf(row);
  return start && start > now ? 'upcoming' : 'open';
}

/* One crew member signing.

   NOTE the deliberate absence of .select() -- a crew member has no account
   and cannot read signatures back, and Postgres rejects an anonymous
   `insert ... returning` with a message that looks like the insert itself
   was refused. Adding .select() here breaks signing for every real user
   while working fine for anyone signed in, which is the worst kind of bug.

   SIGNING STOPS AT EXPIRY. This used to record late signatures and flag
   them rather than refuse, on the reasoning that turning a man away at
   3:45 for a JSA that expired at 3:30 leaves an unsigned worker on an
   active job. Fonzo overruled that 2026-09-11 -- "no point in signing when
   the work is done" -- and he is right that the better answer to work
   running past its JSA is a new JSA, not a signature on a stale hazard
   assessment. An expired JSA is a document whose hazards were assessed for
   a window that has closed.

   The database is what enforces it (see the migration); this refusal is
   only the readable version of the same rule. The is_late column stays for
   the signatures already recorded under the old behaviour. */
export async function signPublication({ publicationId, signerName, signatureData, source = 'phone', expiresAt }) {
  blockInDemo(`Signing`);
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
  if (error) {
    /* The database refuses a signature on an expired JSA. Postgres reports
       that as a row-level-security violation, which to a man standing in a
       parking lot reads like the app broke. Say what actually happened. */
    const refused = /row-level security|violates row-level/i.test(error.message || '');
    if (refused) {
      throw new Error("This JSA has expired, so it can't be signed any more. Ask your superintendent for today's JSA.");
    }
    throw new Error(`Could not record your signature: ${error.message}`);
  }
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
/* Takes a posting off the board. Only your own, and only while nobody has
   signed it -- both enforced in the database, not here, so a mistake in
   this file can't widen it (see the take_down_unsigned_posting migration).

   This exists because catching your own mistake and then being unable to
   fix it is its own kind of broken. The moment somebody has signed, this
   stops working on purpose: that is a record of who agreed to what, and
   the way to correct it is a new version, not an eraser. */
export async function takeDownPublication(publicationId) {
  blockInDemo(`Taking a posting down`);
  const user = await currentUser();
  if (!user) throw new NotSignedInError();

  const { error } = await db
    .from('jsa_publications')
    .delete()
    .eq('id', publicationId)
    .eq('board_owner', user.id);
  if (error) throw new Error(`Could not take it down: ${error.message}`);

  // A delete that matched no row comes back clean, so confirm it is
  // actually gone rather than reporting a success we did not verify --
  // the usual cause would be somebody signing it a second before.
  const { data: still } = await db
    .from('jsa_publications')
    .select('id')
    .eq('id', publicationId)
    .maybeSingle();
  if (still) {
    throw new Error('Somebody signed it just now, so it has to stay. Publish a corrected version instead.');
  }
}

export async function fetchMyBoard() {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();

  /* Filtered on when a posting STOPS being live, not on when it was
     published -- and that distinction is the night shift.

     It used to ask for anything published since local midnight, which
     quietly dropped every overnight JSA the moment the clock rolled over:
     published at 5pm, good until 4am, gone from the superintendent's board
     at midnight while his crew could still scan it and sign. He loses the
     signed count on exactly the shift where he is least likely to be
     standing next to anybody. Found by an outside reviewer, 2026-09-11.

     expires_at past local midnight keeps everything still relevant --
     this morning's JSAs after they close, tonight's while it runs, and
     tomorrow's if it is already up -- and still leaves last week's out,
     which is what the old filter was reaching for. */
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { data, error } = await db
    .from('jsa_publications')
    .select('id, area_label, job_site, location, job_number, doc_date, published_at, expires_at, version, client_doc_id, data, pdf_path')
    .eq('board_owner', user.id)
    .gt('expires_at', since.toISOString())
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

/* The crew's signatures for a JSA, in the shape the printed sign-in sheet
   expects.

   The two live apart on purpose: a signature made on a phone lands in the
   jsa_signatures table, while the printed sheet draws from the JSA's own
   crewSignatures array on the device. Nothing joined them, which is why a
   published JSA's PDF came out with blank lines even after fifty men had
   signed (Fonzo, 2026-09-09: "after someone signs it doesn't show up on
   the PDF").

   Matched on client_doc_id -- the id the JSA carries on the device -- so
   this works for whichever of the morning's JSAs is being finished, not
   just the last one published. Ordered by signing time, so box 1 is the
   first man who signed. */
export async function fetchSignaturesForJsa(clientDocId) {
  if (!clientDocId) return [];

  const { data: pubs, error: pubErr } = await db
    .from('jsa_publications')
    .select('id')
    .eq('client_doc_id', clientDocId);
  if (pubErr) throw new Error(pubErr.message);
  if (!pubs?.length) return [];

  const { data, error } = await db
    .from('jsa_signatures')
    .select('signature_data, signed_at')
    .in('publication_id', pubs.map(p => p.id))
    .order('signed_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data || []).map(s => ({ dataUrl: s.signature_data, signedAt: s.signed_at }));
}

/* ── What still needs archiving ───────────────────────────────────────────
   Every JSA on my board whose time is up and which has not yet reached the
   archive, with its crew's signatures already merged in and ready to print.

   This is what makes a night crew work: Fonzo does not show up, so nobody
   is there to press anything. Today he prints a JSA and hopes they sign it.
   With this, they scan, they sign, and the signed record files itself.

   "Already filed" is DERIVED, not stored: the publications table is
   append-only so a row can never be marked done, but documents.client_doc_id
   records which JSA a filed record came from. Comparing the two is what
   makes this safe to run over and over -- reopening the app cannot produce
   a second copy.

   signInMode is forced to 'kiosk' when signatures exist, because the
   printed sheet deliberately ignores captured signatures in 'printout'
   mode. Archiving must never route through paper or it files a blank
   sign-in sheet. */
export async function fetchUnfiledExpired() {
  const user = await currentUser();
  if (!user) return [];

  /* Two steps, and the order is the whole point.
     This used to take the 20 OLDEST expired postings and then filter out
     the ones already filed. Once those 20 were all filed, every run
     produced an empty list and posting 21 was never looked at again --
     auto-archiving stopped forever, silently, with paperwork simply never
     reaching the archive. Found by an outside reviewer, 2026-09-11.

     So the ids come first and cheaply (no `data`, which is a whole JSA
     with signature images in it), get filtered against what is already
     filed, and only then are the survivors fetched in full. The window is
     bounded because a posting that expired months ago and never got filed
     is not going to start now, and dragging the entire history back on
     every app start to discover that would be its own bug. */
  const WINDOW_DAYS = 60;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await db
    .from('jsa_publications')
    .select('id')
    .eq('board_owner', user.id)
    .lt('expires_at', new Date().toISOString())
    .gt('expires_at', since)
    .order('expires_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!candidates?.length) return [];

  /* Deduped per PUBLICATION, not per JSA. Republishing the same JSA --
     correcting a time, putting it back up for a second crew -- produces
     several board postings that share one client_doc_id, and each posting
     carries its own signatures and deserves its own record. Keying on the
     JSA would file the first and silently swallow the rest.

     The marker lives inside the filed document's own data because the
     archive is append-only and has no column to add. */
  const { data: filed, error: filedErr } = await db
    .from('documents')
    .select('marker:data->>archivedPublicationId')
    .eq('doc_type', 'jsa');
  if (filedErr) throw new Error(filedErr.message);
  const already = new Set((filed || []).map(r => r.marker).filter(Boolean));

  /* Now the filter, THEN the limit -- so progress is always made. */
  const todo = candidates.filter(p => !already.has(p.id)).slice(0, 20).map(p => p.id);
  if (!todo.length) return [];

  const { data: expired, error: fullErr } = await db
    .from('jsa_publications')
    .select('id, client_doc_id, area_label, data, expires_at')
    .in('id', todo)
    .order('expires_at', { ascending: true });
  if (fullErr) throw new Error(fullErr.message);
  const pending = expired || [];
  if (!pending.length) return [];

  const { data: sigs, error: sigErr } = await db
    .from('jsa_signatures')
    .select('publication_id, signature_data, signed_at')
    .in('publication_id', pending.map(p => p.id))
    .order('signed_at', { ascending: true });
  if (sigErr) throw new Error(sigErr.message);

  const byPub = (sigs || []).reduce((acc, s) => {
    (acc[s.publication_id] = acc[s.publication_id] || []).push({ dataUrl: s.signature_data, signedAt: s.signed_at });
    return acc;
  }, {});

  return pending.map(p => {
    const crewSignatures = byPub[p.id] || [];
    return {
      publicationId: p.id,
      label: p.area_label,
      signedCount: crewSignatures.length,
      jsa: {
        ...p.data,
        crewSignatures,
        signInMode: crewSignatures.length ? 'kiosk' : (p.data?.signInMode || 'kiosk'),
        // What stops this being filed twice. See the dedupe above.
        archivedPublicationId: p.id,
      },
    };
  });
}

/* A signature taken on the superintendent's iPad for a board posting.

   No name, deliberately. Fonzo, 2026-09-09: "if they're too fucking lazy
   to do it on their goddamn phone, which is the easiest way possible,
   asking them to type in their name is like asking for the world." The
   database has enforced this shape since day one -- a phone signature must
   carry a name, a kiosk one may not.

   Lands in exactly the same table as a phone signature, which is the point:
   the two used to live apart (cloud vs the JSA on the device) and that
   split caused every blank sign-in sheet of 2026-09-09. */
export async function signOnKiosk({ publicationId, signatureData, expiresAt }) {
  blockInDemo(`Signing`);
  return signPublication({
    publicationId,
    signerName: null,
    signatureData,
    source: 'kiosk',
    expiresAt,
  });
}
