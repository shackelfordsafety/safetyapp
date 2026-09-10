import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import { blockInDemo } from '../shared/demoMode';

/* ── Your name, as the company has it ────────────────────────────────────
   Everyone in here got their name typed in by hand by me, or has no name
   at all. That name ends up attached to company safety records, so the man
   it belongs to should be the one who sets it.

   NAME YES, ROLE NO. What you can see and file is a permission somebody
   else grants; it is shown here so you know where you stand and is not
   editable, and that is enforced in the database rather than by hiding an
   input -- set_my_display_name() touches exactly one column and reads who
   you are from the session, so there is no request this screen could make
   that changes anything else. A screen that merely declined to show a
   field would be a suggestion, not a rule.

   Lazily loaded from Settings, so a signed-out superintendent still gets
   Settings with no cloud code in it. */

const ROLE_WORDS = {
  safety: 'Safety',
  hr: 'HR',
  pm: 'Project Manager',
  clerk: 'Clerk',
  superintendent: 'Superintendent',
  foreman: 'Foreman',
  field: 'Not assigned yet',
};

const ROLE_MEANS = {
  safety: 'You can see every document in the archive.',
  hr: 'You can see every document in the archive.',
  pm: 'You can see every document in the archive.',
  clerk: 'You can see every document in the archive.',
  superintendent: 'You can see your own documents, plus every disciplinary form.',
  foreman: 'You can see your own documents, plus every disciplinary form.',
  field: 'You can see the documents you filed yourself. Ask Fonzo to set your role.',
};

export default function ProfileCard({ session }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { data: user } = await db.auth.getUser();
      const id = user?.user?.id;
      if (!id) { setState('ready'); setProfile(null); return; }
      const { data, error: err } = await db
        .from('profiles').select('full_name, role').eq('id', id).maybeSingle();
      if (err) throw err;
      setProfile(data || { full_name: null, role: 'field' });
      setName(data?.full_name || '');
      setState('ready');
    } catch (ex) {
      setError(ex?.message || 'Could not load your profile. Check your signal.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      blockInDemo('Changing your name');
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { data, error: err } = await db.rpc('set_my_display_name', { new_name: name });
      if (err) throw new Error(err.message);
      setProfile(p => ({ ...p, full_name: data }));
      setName(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (ex) {
      setError(ex?.message || 'Could not save it. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const dirty = (profile?.full_name || '') !== name.trim();

  return (
    <div className="card">
      <div className="cardHeader">
        <h3>Your Profile</h3>
        <p>The name here goes on company records. Use the name the company has you under, not a nickname.</p>
      </div>
      <div className="cardBody">
        {state === 'loading' && <p className="helperText">Loading…</p>}
        {state === 'error' && (
          <>
            <p className="archiveError">{error}</p>
            <button type="button" className="btn ghost sm" onClick={load}>Try again</button>
          </>
        )}

        {state === 'ready' && (
          <form onSubmit={save}>
            <label className="field">
              <span>Full name</span>
              <input
                value={name}
                onChange={e => { setName(e.target.value); setSaved(false); }}
                placeholder="Alfonso Hernandez Jr."
                autoComplete="name"
                maxLength={80}
              />
            </label>

            <div className="settingsRow">
              <div className="rowInfo">
                <strong>{ROLE_WORDS[profile?.role] || 'Not assigned yet'}</strong>
                <p>
                  {ROLE_MEANS[profile?.role] || ROLE_MEANS.field}
                  {' '}Your role is set for you — it decides what you can see, so it isn&apos;t
                  something you can change here.
                </p>
              </div>
            </div>

            <p className="helperText">Signed in as {session?.email}</p>

            {error && <p className="archiveError">{error}</p>}

            <button type="submit" className="btn primary sm" disabled={busy || !dirty || name.trim().length < 2}>
              {busy ? 'Saving…' : saved ? 'Saved' : 'Save name'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
