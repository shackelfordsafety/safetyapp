import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './jobs.css';

/* ── The job list, kept by the office ────────────────────────────────────
   The other half of the picker on Job Info. The picker is only worth
   anything if somebody maintains the list, and until tonight the tables
   had sat empty since the day they were created.

   Who may add a job is the database's decision, not this screen's -- only
   office roles can, which is why a superintendent sees the list and his
   own shortlist here and no "Add a job" form. He is not being told no; he
   is being shown what he can actually do, and typing a job number by hand
   on the JSA still works exactly as before.

   The offer at the bottom is the part worth being careful about. Job
   numbers that have already been typed onto real documents are the best
   guess at what the job list should contain -- but they are company data,
   and a typo typed once would become a permanent job if this created them
   on its own. So it offers, and a person confirms, one at a time. */

export default function JobsCard() {
  const [state, setState] = useState({ ready: false, jobs: [], mine: [], canAdd: false, signedIn: false });
  const [suggested, setSuggested] = useState([]);
  const [form, setForm] = useState({ jobNumber: '', name: '', location: '', client: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const mod = await loadModule(() => import('./jobsStore'));
      if (!mod) return;
      const [{ jobs, mine, signedIn }, canAdd] = await Promise.all([mod.listJobs(), mod.canAddJobs()]);
      setState({ ready: true, jobs, mine, canAdd, signedIn });
      if (canAdd) {
        try { setSuggested(await mod.jobNumbersNotOnTheList()); } catch { setSuggested([]); }
      }
    } catch {
      setState({ ready: false, jobs: [], mine: [], canAdd: false, signedIn: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function withStore(key, fn) {
    setBusy(key);
    setError('');
    setNote('');
    try {
      const mod = await loadModule(() => import('./jobsStore'));
      if (mod) await fn(mod);
      await load();
    } catch (ex) {
      setError(ex?.message || 'That did not go through.');
    } finally {
      setBusy('');
    }
  }

  const toggleMine = (job) => withStore(`mine:${job.id}`, async (mod) => {
    await mod.setMine(job.id, !state.mine.includes(job.id));
  });

  const add = () => withStore('add', async (mod) => {
    await mod.createJob(form);
    setForm({ jobNumber: '', name: '', location: '', client: '' });
    setNote('Added.');
  });

  const addSuggested = (jobNumber) => withStore(`sug:${jobNumber}`, async (mod) => {
    /* The number is all a filed document actually knows, so the name
       starts as the number. Somebody renames it to something a man would
       recognise; nothing is invented here. */
    await mod.createJob({ jobNumber, name: jobNumber });
    setNote(`${jobNumber} is on the list. Give it a name people will recognise.`);
  });

  if (!state.ready) return null;

  return (
    <div className="card">
      <div className="cardHeader">
        <h3>Jobs</h3>
        <p>
          The list the JSA picks from, so a job number is typed once and spelled the same
          way every time after that. Typing one in by hand on a JSA still works.
        </p>
      </div>
      <div className="cardBody">
        {error && <p className="jobsError">{error}</p>}
        {note && <p className="jobsNote">{note}</p>}

        {state.jobs.length === 0 ? (
          <p className="helperText">
            No jobs on the list yet.{state.canAdd ? ' Add one below.' : ' The office keeps this list.'}
          </p>
        ) : (
          <div className="jobsAdmin">
            {state.jobs.map(j => (
              <div className="jobsAdminRow" key={j.id}>
                <span className="jobRowNum">{j.job_number}</span>
                <span className="jobRowText">
                  <strong>{j.name}</strong>
                  <span>{[j.location, j.client].filter(Boolean).join(' · ') || 'No location on file'}</span>
                </span>
                <button
                  type="button"
                  className={`btn ${state.mine.includes(j.id) ? 'secondary' : 'ghost'} sm`}
                  onClick={() => toggleMine(j)}
                  disabled={busy === `mine:${j.id}` || !state.signedIn}
                >
                  {/* "One of mine" rather than a star: a super running four
                      jobs out of the company's forty wants those four at
                      the front of the picker, and that is what this says. */}
                  {state.mine.includes(j.id) ? 'One of mine' : 'Add to mine'}
                </button>
              </div>
            ))}
          </div>
        )}

        {state.canAdd && (
          <div className="jobsAdd">
            <strong className="jobsAddHead">Add a job</strong>
            <div className="jobsAddGrid">
              <label className="field">
                <span>Job #</span>
                <input
                  value={form.jobNumber}
                  onChange={e => setForm(f => ({ ...f, jobNumber: e.target.value }))}
                  placeholder="24-118"
                />
              </label>
              <label className="field">
                <span>Job site</span>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="What the crew calls it"
                />
              </label>
              <label className="field">
                <span>Location / city</span>
                <input
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Client</span>
                <input
                  value={form.client}
                  onChange={e => setForm(f => ({ ...f, client: e.target.value }))}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn primary"
              onClick={add}
              disabled={busy === 'add' || !form.jobNumber.trim()}
            >
              {busy === 'add' ? 'Adding…' : 'Add this job'}
            </button>
          </div>
        )}

        {state.canAdd && suggested.length > 0 && (
          <div className="jobsSuggest">
            <strong className="jobsAddHead">Already being used, not on the list</strong>
            <p className="helperText">
              These job numbers are on documents the company has already filed or published.
              Nothing is added until you say so.
            </p>
            <div className="jobsSuggestRow">
              {suggested.map(s => (
                <button
                  key={s.jobNumber}
                  type="button"
                  className="jobSuggestChip"
                  onClick={() => addSuggested(s.jobNumber)}
                  disabled={busy === `sug:${s.jobNumber}`}
                >
                  <strong>{s.jobNumber}</strong>
                  <span>{s.count === 1 ? 'on 1 document' : `on ${s.count} documents`}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
