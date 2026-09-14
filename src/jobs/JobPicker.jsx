import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './jobs.css';

/* ── Pick the job instead of remembering the number ──────────────────────
   The same job gets typed three different ways across three JSAs, and
   then the archive cannot group by it. Fonzo asked for job number over
   job site in Records because it is "easier to notice which jobs we
   have"; this is what makes that number worth grouping by.

   Three rules this is built around, in order:

   1. IT CAN NEVER BLOCK A JSA. Only office roles may create a job in the
      database, so a superintendent standing at a gate at 6am on a job
      nobody has entered yet must still be able to type the number in and
      carry on. The fields below are untouched and still the real ones --
      this only fills them in faster.

   2. IT MUST WORK WITH NO SIGNAL. The list is cached on the device, so a
      man who loaded it once keeps it in the valley. With no cache and no
      signal it simply is not there, and the form is the form it has
      always been.

   3. IT SAYS WHAT IT WILL DO BEFORE IT DOES IT. Tapping a job overwrites
      four fields somebody may have already typed into, so anything
      already filled in is named in the confirm rather than silently
      replaced. Supers and foremen skew older and not tech-savvy -- a
      picker that quietly rewrites the form teaches people not to trust
      the screen. */

/* The four fields a job actually knows. Everything else on the step --
   the date, the times, the area, the muster point -- changes day to day
   and is nobody's business but today's. */
function fillFrom(job) {
  return {
    jobNumber: job.job_number || '',
    jobSite: job.name || '',
    ...(job.location ? { location: job.location } : {}),
    ...(job.client ? { client: job.client } : {}),
  };
}

function conflicts(jsa, next) {
  const LABELS = { jobNumber: 'Job #', jobSite: 'Job Site', location: 'Location', client: 'Client' };
  return Object.keys(next)
    .filter(k => String(jsa[k] || '').trim() && String(jsa[k]).trim() !== String(next[k]).trim())
    .map(k => LABELS[k]);
}

export default function JobPicker({ jsa, upd }) {
  const [state, setState] = useState({ ready: false, jobs: [], mine: [] });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const mod = await loadModule(() => import('./jobsStore'));
      if (!mod) return;
      const { jobs, mine } = await mod.listJobs();
      setState({ ready: true, jobs, mine });
    } catch {
      /* Never breaks the step. No list is the state this screen was in
         for its whole life until tonight. */
      setState({ ready: true, jobs: [], mine: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function apply(job) {
    const next = fillFrom(job);
    const clash = conflicts(jsa, next);
    if (clash.length) { setConfirm({ job, next, clash }); return; }
    upd(next);
    setOpen(false);
  }

  if (!state.ready || state.jobs.length === 0) return null;

  const mineFirst = [...state.jobs].sort((a, b) => {
    const am = state.mine.includes(a.id) ? 0 : 1;
    const bm = state.mine.includes(b.id) ? 0 : 1;
    return am - bm || String(a.job_number).localeCompare(String(b.job_number));
  });
  const shortlist = mineFirst.filter(j => state.mine.includes(j.id)).slice(0, 4);
  const q = query.trim().toLowerCase();
  const matching = q
    ? mineFirst.filter(j => `${j.job_number} ${j.name} ${j.location || ''} ${j.client || ''}`.toLowerCase().includes(q))
    : mineFirst;
  const current = String(jsa.jobNumber || '').trim().toLowerCase();

  return (
    <div className="jobPick">
      <span className="jobPickLabel">Which job is this?</span>
      <div className="jobPickRow">
        {(shortlist.length ? shortlist : mineFirst.slice(0, 4)).map(j => (
          <button
            key={j.id}
            type="button"
            className={`jobChip${String(j.job_number).toLowerCase() === current ? ' active' : ''}`}
            onClick={() => apply(j)}
          >
            <strong>{j.job_number}</strong>
            <span>{j.name}</span>
          </button>
        ))}
        <button type="button" className="jobChip jobChip--more" onClick={() => { setQuery(''); setOpen(true); }}>
          <strong>All jobs</strong>
          <span>{state.jobs.length} on the list</span>
        </button>
      </div>
      {/* Says the quiet part out loud, because the fields underneath still
          being editable is the whole reason this is safe to ship. */}
      <p className="jobPickNote">Fills in the four fields below. You can still type a job in by hand.</p>

      {open && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dialogPanel jobDialog" role="dialog" aria-modal="true" aria-label="Pick a job">
            <h3 style={{ margin: 0 }}>Pick a job</h3>
            <input
              type="search"
              className="jobSearch"
              placeholder="Job number, site, or client"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search jobs"
            />
            <div className="jobList">
              {matching.length === 0 && <p className="helperText">Nothing matches &ldquo;{query}&rdquo;.</p>}
              {matching.map(j => (
                <button key={j.id} type="button" className="jobRow" onClick={() => apply(j)}>
                  <span className="jobRowNum">{j.job_number}</span>
                  <span className="jobRowText">
                    <strong>{j.name}</strong>
                    <span>{[j.location, j.client].filter(Boolean).join(' · ') || 'No location on file'}</span>
                  </span>
                  {state.mine.includes(j.id) && <span className="jobRowMine">Yours</span>}
                </button>
              ))}
            </div>
            <div className="dialogActions">
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Replace what you typed?">
            <h3 style={{ margin: 0 }}>Replace what you typed?</h3>
            <p className="helperText">
              Using <strong>{confirm.job.job_number} &middot; {confirm.job.name}</strong> will overwrite{' '}
              {confirm.clash.join(', ')}.
            </p>
            <div className="dialogActions">
              <button type="button" className="btn secondary" onClick={() => setConfirm(null)}>Keep what I typed</button>
              <button
                type="button"
                className="btn primary"
                onClick={() => { upd(confirm.next); setConfirm(null); setOpen(false); }}
              >
                Use this job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
