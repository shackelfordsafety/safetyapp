import { db } from '../archive/archiveClient';
import { blockInDemo } from '../shared/demoMode';

/* ── Documents that aren't finished yet ──────────────────────────────────
   The in-between that did not exist: a document was either on one man's
   iPad where nobody could see it and where it died with the device, or in
   the archive permanently with no edit and no delete.

   Imported ONLY from lazily loaded code, like everything else that talks
   to the cloud, so building a document stays login-free and offline.

   WHAT THIS IS NOT: it is not where the document is edited. The workflows
   keep their own local draft and their own autosave, untouched -- that is
   what makes this app work in a truck with no signal, and it stays the
   source of truth while somebody is typing. This is the copy other people
   can see, pushed up when there is signal and pulled down by whoever picks
   it up next. */

export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to share a document.');
    this.name = 'NotSignedInError';
  }
}

/* The same three fields the archive summarises by, so the list can show
   and search without opening every document. Kept in step with SUMMARY in
   fileToArchive.js -- if a model's field names change, both move. */
const SUMMARY = {
  jsa: m => ({ employee_name: null, job_site: m.jobSite || m.location || null, doc_date: m.date || null }),
  incident: m => ({ employee_name: m.injuredPartyName || null, job_site: m.workplaceLocation || null, doc_date: m.incidentDate || null }),
  disciplinary: m => ({ employee_name: m.employeeName || null, job_site: null, doc_date: m.noticeDate || null }),
  separation: m => ({ employee_name: m.employeeName || null, job_site: m.projectLocation || null, doc_date: m.lastDayWorked || null }),
  medicalEvent: m => ({ employee_name: m.employeeName || null, job_site: m.projectLocation || null, doc_date: m.eventDate || null }),
  uncontrolledEvent: m => ({ employee_name: null, job_site: m.workplaceLocation || null, doc_date: m.eventDate || null }),
};

function blank(v) {
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
}

async function currentUser() {
  const { data } = await db.auth.getUser();
  return data?.user || null;
}

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();
  return user;
}

/* Names for the ids on each row. Fetched separately and joined here rather
   than through PostgREST: created_by points at auth.users, profiles points
   at auth.users, and PostgREST cannot infer a relationship between two
   tables that merely share a target. */
async function namesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await db.from('profiles').select('id, full_name, role').in('id', unique);
  const map = {};
  (data || []).forEach((p) => { map[p.id] = p; });
  return map;
}

/* Everyone this person could hand a document to. Names and roles only --
   see the profiles directory migration for why that is not sensitive. */
export async function peopleToHandTo() {
  const me = await requireUser();
  const { data, error } = await db
    .from('profiles')
    .select('id, full_name, role')
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data || [])
    .filter(p => p.id !== me.id)
    // Somebody with no name set yet would show as an empty row in a picker.
    .map(p => ({ ...p, full_name: p.full_name || 'Name not set yet' }));
}

export async function listOpenDocuments() {
  await requireUser();
  const { data, error } = await db
    .from('open_documents')
    .select('id, doc_type, created_by, created_at, updated_by, updated_at, assigned_to, waiting_on, employee_name, job_site, doc_date, client_doc_id, locked_by, locked_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data || [];
  const names = await namesFor(rows.flatMap(r => [r.created_by, r.assigned_to, r.updated_by, r.locked_by]));
  return rows.map(r => ({
    ...r,
    createdByName: names[r.created_by]?.full_name || null,
    assignedToName: names[r.assigned_to]?.full_name || null,
    updatedByName: names[r.updated_by]?.full_name || null,
    lockedByName: names[r.locked_by]?.full_name || null,
  }));
}

/* The whole document, for picking one up. */
export async function getOpenDocument(id) {
  await requireUser();
  const { data, error } = await db
    .from('open_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That document is no longer open — somebody may have filed it.');
  return data;
}

/* Put a document up so other people can see and finish it, or push the
   latest version of one already up there. Returns the row id, which the
   workflow holds on to so later saves update rather than duplicate. */
export async function shareOpenDocument({ id, docType, model, waitingOn, assignedTo }) {
  blockInDemo('Sharing a document');
  const user = await requireUser();

  const summarize = SUMMARY[docType];
  if (!summarize) throw new Error(`Unknown document type "${docType}".`);
  const summary = summarize(model || {});

  const row = {
    doc_type: docType,
    data: model,
    client_doc_id: model?.id || null,
    employee_name: blank(summary.employee_name),
    job_site: blank(summary.job_site),
    doc_date: blank(summary.doc_date),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  if (waitingOn !== undefined) row.waiting_on = blank(waitingOn);
  if (assignedTo !== undefined) row.assigned_to = assignedTo || null;

  if (id) {
    const { error } = await db.from('open_documents').update(row).eq('id', id);
    if (error) throw new Error(`Could not save it: ${error.message}`);
    return { id };
  }

  const { data, error } = await db
    .from('open_documents')
    .insert({ ...row, created_by: user.id })
    .select('id')
    .single();
  if (error) throw new Error(`Could not share it: ${error.message}`);
  return { id: data.id };
}

/* Hand it to somebody, with what it is waiting on. Separate from saving
   the document so the list screen can do it without loading the whole
   thing. */
export async function handOver({ id, assignedTo, waitingOn }) {
  blockInDemo('Handing a document over');
  const user = await requireUser();
  const { error } = await db.from('open_documents').update({
    assigned_to: assignedTo || null,
    waiting_on: blank(waitingOn),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(`Could not hand it over: ${error.message}`);
}

/* A hint, not a lock -- see the migration. Claimed when somebody opens a
   document to work on it, released when they put it down. Nothing is
   enforced on top of it: this app has to keep working with no signal, and
   a lock that cannot be released by a man who drove out of range would
   strand the document instead of protecting it. */
export async function claim(id) {
  blockInDemo('Opening a shared document');
  const user = await requireUser();
  await db.from('open_documents').update({
    locked_by: user.id,
    locked_at: new Date().toISOString(),
  }).eq('id', id);
}

export async function release(id) {
  const user = await currentUser();
  if (!user) return;
  await db.from('open_documents').update({ locked_by: null, locked_at: null }).eq('id', id);
}

/* A claim older than this is treated as stale by the list screen -- the
   iPad went in a truck and the man forgot. Long enough to cover a real
   working session, short enough that nobody waits a day. */
export const STALE_CLAIM_MINUTES = 90;

export function claimIsStale(lockedAt) {
  if (!lockedAt) return true;
  const at = new Date(lockedAt).getTime();
  if (Number.isNaN(at)) return true;
  return Date.now() - at > STALE_CLAIM_MINUTES * 60000;
}

/* Give up on a draft. Deliberately possible -- half-started documents that
   can never be removed are how a list becomes something people stop
   reading. */
export async function abandon(id) {
  blockInDemo('Removing a shared document');
  await requireUser();
  const { error } = await db.from('open_documents').delete().eq('id', id);
  if (error) throw new Error(`Could not remove it: ${error.message}`);
}

/* Once it is filed to the archive it is no longer open. Called after a
   successful file, never before -- if the archive write fails, the
   document must stay here rather than vanishing from both places. */
export async function closeAfterFiling(id) {
  if (!id) return;
  try {
    await db.from('open_documents').delete().eq('id', id);
  } catch {
    /* The document IS filed; a leftover open row is untidy, not lost work.
       Better to leave it and let somebody remove it than to make a filed
       document look like it failed. */
  }
}
