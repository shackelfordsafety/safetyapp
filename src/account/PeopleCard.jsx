import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import { blockInDemo } from '../shared/demoMode';
import { ROLE_WORDS } from './ProfileCard';

/* ── Who is in the app, and what each person may see ─────────────────────
   Until this screen existed, changing somebody's role meant opening the
   Supabase dashboard -- and the only login that opens the dashboard is the
   same one that owns the code and the website. Handing that over so
   somebody could correct a foreman's role was a bad trade. This does the
   one job without the keys to everything.

   Deliberately NOT an account manager. It cannot create a person or set a
   password: both need Supabase's admin key, which must never be in browser
   code, so both would need a server-side function this project does not
   have. Adding somebody is still done in the dashboard. Changing what they
   can see is done here, which is the part that actually comes up.

   NO SHARED "ADMIN" LOGIN, on purpose (Fonzo asked, 2026-09-22). Every
   filed document records which person submitted and filed it, and
   role_changes records who made each change. One login shared between
   people turns all of that into "admin" and the app stops being able to
   say who did anything -- which is the whole reason it is trusted with
   safety records. The permission already belongs to real accounts:
   can_manage_people() is `is_admin OR role in ('hr','owner')`.

   The database is the rule, not this screen. set_person_role() re-checks
   the permission, refuses to let anybody change their own role, refuses
   any role that is not real, allows only an owner to make or unmake an
   owner, and writes an audit row that cannot be forged (role_changes has
   no INSERT policy -- only that function can write it). Everything below
   is a convenience on top of rules that hold with or without it. */

const ROLE_ORDER = ['field', 'superintendent', 'foreman', 'clerk', 'pm', 'hr', 'safety', 'owner'];

/* What each role actually means, in the words somebody choosing one needs.
   The names are not guessable -- a clerk sees everything and approves
   nothing, a foreman sees almost nothing but every disciplinary -- so the
   picker says it out loud rather than assuming. */
const ROLE_MEANS = {
  field: 'Only the documents they filed themselves.',
  superintendent: 'Their own documents, plus every disciplinary notice.',
  foreman: 'Their own documents, plus every disciplinary notice.',
  clerk: 'Every filed document. Approves nothing.',
  pm: 'Every filed document. Approves incidents, medical events and uncontrolled events.',
  hr: 'Every filed document. Approves disciplinary notices and separations.',
  safety: 'Every filed document. Approves nothing.',
  owner: 'Everything, including approving any document.',
};

function fmtWhen(t) {
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function PeopleCard() {
  const [state, setState] = useState('loading'); // loading | ready | error | hidden
  const [me, setMe] = useState(null);
  const [people, setPeople] = useState([]);
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState({});   // id -> role chosen but not saved
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { data: user } = await db.auth.getUser();
      const id = user?.user?.id;
      if (!id) { setState('hidden'); return; }

      const { data: rows, error: err } = await db
        .from('profiles').select('id, full_name, role, is_admin');
      if (err) throw err;

      const mine = (rows || []).find(r => r.id === id) || null;
      const canManage = Boolean(mine && (mine.is_admin || mine.role === 'hr' || mine.role === 'owner'));
      if (!canManage) { setState('hidden'); return; }

      setMe(mine);
      setPeople([...(rows || [])].sort((a, b) =>
        (a.full_name || '￿').localeCompare(b.full_name || '￿')));

      /* Readable only by somebody who can manage people, so this is safe to
         ask for here and would come back empty anywhere else. */
      const { data: changes } = await db
        .from('role_changes')
        .select('id, target_user, old_role, new_role, changed_by, changed_at')
        .order('changed_at', { ascending: false })
        .limit(8);
      setHistory(changes || []);
      setState('ready');
    } catch (ex) {
      setError(ex?.message || 'Could not load the people list. Check your signal.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveRole(person) {
    const next = draft[person.id];
    if (!next || next === person.role) return;
    setBusyId(person.id);
    setError('');
    setSavedId('');
    try {
      blockInDemo('Changing a role');
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { error: err } = await db.rpc('set_person_role', { target: person.id, new_role: next });
      if (err) throw new Error(err.message);
      setSavedId(person.id);
      setTimeout(() => setSavedId(''), 2500);
      await load();
    } catch (ex) {
      setError(ex?.message || 'Could not change that role. Check your signal and try again.');
    } finally {
      setBusyId('');
    }
  }

  if (state === 'hidden') return null;

  const iAmOwner = me?.role === 'owner';
  const nameOf = id => people.find(p => p.id === id)?.full_name || 'Someone';

  return (
    <div className="card">
      <div className="cardHeader">
        <h3>People</h3>
        <p>
          What each person can see in Records. Adding somebody new, or resetting a
          password, is still done from the database dashboard.
        </p>
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
          <>
            {error && <p className="archiveError">{error}</p>}

            <div className="peopleList">
              {people.map(p => {
                const isMe = p.id === me.id;
                /* Only an owner can make or unmake an owner -- the database
                   refuses otherwise, so the screen says so up front instead
                   of letting somebody pick it and read an error. */
                const lockedByOwnerRule = !iAmOwner && (p.role === 'owner');
                const locked = isMe || lockedByOwnerRule;
                const chosen = draft[p.id] ?? p.role;
                const dirty = chosen !== p.role;

                return (
                  <div className="peopleRow" key={p.id}>
                    <div className="peopleWho">
                      <strong>
                        {p.full_name || 'Name not set yet'}
                        {p.is_admin && <span className="peopleTag">full access</span>}
                      </strong>
                      <span className="peopleNow">
                        {isMe ? 'You — ' : ''}{ROLE_WORDS[p.role] || p.role}
                      </span>
                    </div>

                    {locked ? (
                      <p className="helperText peopleLocked">
                        {isMe
                          ? 'You cannot change your own role. Ask an owner.'
                          : 'Only an owner can change an owner.'}
                      </p>
                    ) : (
                      <div className="peopleEdit">
                        <label className="field">
                          <span>Can see</span>
                          <select
                            value={chosen}
                            onChange={e => setDraft(d => ({ ...d, [p.id]: e.target.value }))}
                          >
                            {ROLE_ORDER.map(r => (
                              <option key={r} value={r} disabled={r === 'owner' && !iAmOwner}>
                                {ROLE_WORDS[r] || r}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="helperText">{ROLE_MEANS[chosen]}</p>
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={!dirty || busyId === p.id}
                          onClick={() => saveRole(p)}
                        >
                          {busyId === p.id ? 'Saving…' : 'Save role'}
                        </button>
                        {savedId === p.id && <span className="peopleSaved">Saved</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {history.length > 0 && (
              <>
                <div className="peopleHistoryTitle">Recent changes</div>
                <ul className="peopleHistory">
                  {history.map(h => (
                    <li key={h.id}>
                      <strong>{nameOf(h.target_user)}</strong>
                      {' '}went from {ROLE_WORDS[h.old_role] || h.old_role}
                      {' '}to {ROLE_WORDS[h.new_role] || h.new_role}
                      {' · '}{nameOf(h.changed_by)}
                      {' · '}{fmtWhen(h.changed_at)}
                    </li>
                  ))}
                </ul>
                <p className="helperText">
                  This history cannot be edited or removed, by anyone.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
