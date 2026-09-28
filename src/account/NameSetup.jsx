import { useState } from 'react';
import { loadModule } from '../shared/loadModule';
import { blockInDemo } from '../shared/demoMode';

/* ── First sign-in: put your name on your account ────────────────────────
   Fonzo, 2026-09-28: "on first log in, if there's no name, it should make
   you set up your profile... someone was like 'hey it's saying i don't
   have a name' and i was like yea u gotta set it up in the settings".

   This replaces a dismissable banner that sent you off to Settings. The
   name box is right here, and there is no "Later" -- your name goes on
   every record you file, and the banner was the kind of thing people tap
   past. The ONE way out is when saving genuinely fails (no signal): an app
   that traps a man on a dialog in a dead zone is worse than a nameless
   account, so after a failed save it offers to carry on and ask again
   next time.

   Same database call as the Profile card in Settings (set_my_display_name
   touches exactly one column, for the signed-in user only). Lazily loaded,
   like everything that talks to the cloud. */
export default function NameSetup({ email, onDone, onSkip }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      blockInDemo('Setting your name');
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { error: err } = await db.rpc('set_my_display_name', { new_name: name.trim() });
      if (err) throw new Error(err.message);
      onDone?.();
    } catch (ex) {
      /* "TypeError: Failed to fetch" is what no signal looks like to the
         browser. Nobody should have to read that. */
      const msg = ex?.message || '';
      setError(!msg || /fetch|network|load failed/i.test(msg)
        ? 'Couldn’t reach the server. Check your signal and try again.'
        : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialogOverlay nameSetupOverlay">
      <form className="dialogPanel nameSetup" role="dialog" aria-modal="true" aria-label="Set up your name" onSubmit={save}>
        <h3>Welcome — what&apos;s your name?</h3>
        <p className="helperText">
          It goes on every document you fill out, so use the name the company has you under,
          not a nickname. You only do this once.
        </p>
        <label className="field">
          <span>First and last name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="First and last name"
            autoComplete="name"
            maxLength={80}
            autoFocus
          />
        </label>
        {email && <p className="helperText">Signed in as {email}</p>}
        {error && <p className="archiveError">{error}</p>}
        <button type="submit" className="btn primary lg" disabled={busy || name.trim().length < 2}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        {error && (
          <button type="button" className="btn ghost sm" onClick={onSkip}>
            No signal? Skip for now — it&apos;ll ask again next time
          </button>
        )}
        <p className="helperText">You can change it later in Settings.</p>
      </form>
    </div>
  );
}
