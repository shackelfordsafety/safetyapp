import { useState } from 'react';
import { loadModule } from '../shared/loadModule';
import { blockInDemo } from '../shared/demoMode';

/* ── Changing your own password ──────────────────────────────────────────
   Needed the moment anybody but Fonzo has an account. Right now he creates
   logins by hand and hands the password over, which means he knows
   everybody's password and nobody can ever change it. That is fine for one
   person testing and wrong for the owners and HR.

   WHY IT ASKS FOR THE CURRENT PASSWORD. Being signed in is not proof of
   who you are here: this app is used on shared iPads that sit unlocked in
   a job trailer. Without it, anybody who picks one up could lock the real
   owner out of his own account in four taps. So the current password is
   verified against the server first -- an actual sign-in attempt, not a
   check this screen could be talked out of.

   NOT a password RESET. That needs an email, and the project cannot send
   email to anyone outside the Supabase team until custom SMTP is set up.
   Until then, a forgotten password is fixed by Fonzo in the dashboard --
   worth knowing before onboarding anybody. */

export default function ChangePassword({ email }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function reset() {
    setCurrent(''); setNext(''); setConfirm(''); setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (next !== confirm) { setError('The two new passwords don’t match.'); return; }
    if (next.length < 10) { setError('Use at least 10 characters.'); return; }
    if (next === current) { setError('That’s the password you already have.'); return; }

    setBusy(true);
    try {
      blockInDemo('Changing your password');
      const { db } = await loadModule(() => import('../archive/archiveClient'));

      /* Verify the current password by actually using it. Same account, so
         this just refreshes the session -- but a wrong password fails here,
         before anything is changed. */
      const { error: signInErr } = await db.auth.signInWithPassword({ email, password: current });
      if (signInErr) throw new Error('That current password isn’t right.');

      const { error: updErr } = await db.auth.updateUser({ password: next });
      if (updErr) throw new Error(updErr.message);

      reset();
      setDone(true);
      setOpen(false);
      setTimeout(() => setDone(false), 4000);
    } catch (ex) {
      setError(ex?.message || 'Could not change it. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="settingsRow">
        <div className="rowInfo">
          <strong>Password</strong>
          <p>
            {done
              ? 'Changed. Use the new one next time you sign in.'
              : 'Change the password you use to sign in.'}
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={() => { reset(); setOpen(true); }}>
          Change password
        </button>
      </div>
    );
  }

  return (
    <form className="pwForm" onSubmit={submit}>
      <label className="field">
        <span>Current password</span>
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label className="field">
        <span>New password</span>
        <input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required />
      </label>
      <label className="field">
        <span>New password again</span>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
      </label>
      <p className="helperText">
        At least 10 characters. It&apos;s checked against known stolen passwords, so a common
        one will be refused — that&apos;s the check working, not a fault.
      </p>
      {error && <p className="archiveError">{error}</p>}
      <div className="pwFormActions">
        <button type="button" className="btn ghost sm" onClick={() => { setOpen(false); reset(); }}>Cancel</button>
        <button type="submit" className="btn primary sm" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
