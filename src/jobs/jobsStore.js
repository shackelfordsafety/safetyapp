import { db } from '../archive/archiveClient';
import { blockInDemo } from '../shared/demoMode';

/* ── The list of jobs, so a job number is typed once ─────────────────────
   Job numbers are free-typed on every document, so the same job gets
   spelled three ways and the archive cannot group by it. Fonzo asked for
   job number over job site in Records because it is "easier to notice
   which jobs we have" -- this is the real version of that: the number
   comes off a list instead of out of somebody's memory.

   The tables have existed since 2026-09-10 with zero rows and nothing
   reading them. This is the first code that does.

   WHAT THIS IS NOT: it is not a requirement. Typing a job number by hand
   stays exactly as it was, and has to -- the database only lets office
   roles create a job, so a superintendent standing at a gate at 6am on a
   job nobody has entered yet would otherwise be stuck. A picker that can
   block a JSA is worse than no picker.

   Imported ONLY from lazily loaded code, like everything that talks to
   the cloud, so building a JSA stays login-free and offline.

   The list is cached on the device. A job list that only works with a
   signal is a job list that is missing every morning somebody drives into
   a valley, and the contents are not sensitive -- job numbers and site
   names, the same things already printed across the top of every JSA in
   the truck. */

const CACHE_KEY = 'sdc.jobs.v1';

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.jobs)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(jobs, mine) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      jobs, mine, savedAt: Date.now(),
    }));
  } catch {
    /* A full or blocked localStorage costs the offline copy, nothing
       else. Never worth failing the screen over. */
  }
}

/* Wiped on sign-out along with everything else that belongs to a person.
   Kept deliberately small and dumb so signOut does not have to know
   anything about this module beyond the key. */
export const JOBS_CACHE_KEY = CACHE_KEY;

async function currentUser() {
  const { data } = await db.auth.getUser();
  return data?.user || null;
}

/* Every job, newest picks first, each marked with whether this person has
   it on their own shortlist. Falls back to the cached copy on any failure
   -- no signal, signed out mid-morning, the cloud having a bad day -- so
   the picker degrades to "the jobs you saw last time" rather than to
   nothing. */
export async function listJobs() {
  const cached = readCache();
  try {
    const user = await currentUser();
    if (!user) return { jobs: cached?.jobs || [], mine: cached?.mine || [], stale: Boolean(cached), signedIn: false };

    const [{ data: jobs, error }, { data: picks }] = await Promise.all([
      db.from('jobs').select('id, job_number, name, location, client, active').eq('active', true).order('job_number'),
      db.from('my_jobs').select('job_id'),
    ]);
    if (error) throw new Error(error.message);

    const list = jobs || [];
    const mine = (picks || []).map(p => p.job_id);
    writeCache(list, mine);
    return { jobs: list, mine, stale: false, signedIn: true };
  } catch {
    return { jobs: cached?.jobs || [], mine: cached?.mine || [], stale: Boolean(cached), signedIn: false };
  }
}

/* Put a job on, or take it off, this person's own shortlist. A super runs
   four jobs, not the company's forty, and the four should be the ones he
   sees first. Nobody else's list is touched -- my_jobs is per-user by RLS,
   not by convention. */
export async function setMine(jobId, on) {
  blockInDemo('Changing your job list');
  const user = await currentUser();
  if (!user) throw new Error('Sign in to keep a list of your jobs.');
  if (on) {
    const { error } = await db.from('my_jobs').insert({ user_id: user.id, job_id: jobId });
    /* Already on the list is the outcome the caller wanted, not a
       failure. 23505 is the primary key saying so. */
    if (error && error.code !== '23505') throw new Error(error.message);
  } else {
    const { error } = await db.from('my_jobs').delete().eq('job_id', jobId).eq('user_id', user.id);
    if (error) throw new Error(error.message);
  }
}

/* Only office roles may create a job -- that is enforced in the database,
   not here. A superintendent gets a clear sentence back instead of a
   silent failure, and goes on typing the number by hand, which still
   works. */
export async function createJob({ jobNumber, name, location, client }) {
  blockInDemo('Adding a job');
  const user = await currentUser();
  if (!user) throw new Error('Sign in to add a job.');
  const row = {
    job_number: String(jobNumber || '').trim(),
    name: String(name || '').trim(),
    location: String(location || '').trim() || null,
    client: String(client || '').trim() || null,
    created_by: user.id,
  };
  if (!row.job_number) throw new Error('A job needs a number.');
  if (!row.name) row.name = row.job_number;

  const { data, error } = await db.from('jobs').insert(row).select().maybeSingle();
  if (error) {
    if (error.code === '23505') throw new Error(`Job ${row.job_number} is already on the list.`);
    if (/row-level security/i.test(error.message || '')) {
      throw new Error('Only the office can add a job. Type the number in by hand for now and ask them to add it.');
    }
    throw new Error(error.message);
  }
  return data;
}

/* Job numbers already typed into work the company has filed or
   published, that are not on the job list yet. OFFERED, never created --
   a job number is company data, and guessing one into existence is not
   this app's business.

   Two sources because the number lives in two shapes: jsa_publications
   carries it as a real column, and a filed document carries it inside its
   data blob, which is why that one is read through data->>jobNumber
   rather than a column that does not exist. */
export async function jobNumbersNotOnTheList() {
  const user = await currentUser();
  if (!user) return [];
  const [{ data: docs }, { data: pubs }, { data: jobs }] = await Promise.all([
    db.from('documents').select('jobNumber:data->>jobNumber'),
    db.from('jsa_publications').select('job_number'),
    db.from('jobs').select('job_number'),
  ]);
  const known = new Set((jobs || []).map(j => String(j.job_number).trim().toLowerCase()));
  const seen = new Map();
  const note = (value) => {
    const n = String(value || '').trim();
    if (!n || known.has(n.toLowerCase())) return;
    const key = n.toLowerCase();
    seen.set(key, { jobNumber: seen.get(key)?.jobNumber || n, count: (seen.get(key)?.count || 0) + 1 });
  };
  (docs || []).forEach(d => note(d.jobNumber));
  (pubs || []).forEach(p => note(p.job_number));
  return [...seen.values()].sort((a, b) => b.count - a.count || a.jobNumber.localeCompare(b.jobNumber));
}

/* Whether to show this person an "add a job" form at all. The database
   decides for real -- this only decides what to put on screen, and if the
   two ever disagree the database wins and createJob() comes back with a
   sentence a person can act on. Showing a superintendent a form that is
   going to refuse him is its own small insult. */
export async function canAddJobs() {
  try {
    const user = await currentUser();
    if (!user) return false;
    const { data } = await db.from('profiles').select('role, is_admin').eq('id', user.id).maybeSingle();
    if (data?.is_admin) return true;
    return ['owner', 'pm', 'hr', 'safety', 'clerk'].includes(data?.role);
  } catch {
    return false;
  }
}
