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

/* Every failure used to read "That current password isn't right" --
   including no signal, which sent somebody in a trailer dead zone off to
   reset a password that was fine. Audit 2026-09-30.

   supabase-js returns (does not throw) an AuthRetryableFetchError when it
   cannot reach the server at all -- status 0, or a 502/503/504 -- and an
   AuthApiError with code invalid_credentials for a wrong password. */
const NO_SIGNAL = 'No signal right now, so your password was not changed. Try again when you have a connection.';

function isNoSignal(err) {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err.name === 'AuthRetryableFetchError') return true;
  if (err.status === 0 || [502, 503, 504].includes(err.status)) return true;
  return /failed to fetch|network|load failed|fetch/i.test(String(err.message || ''));
}

function signInMessage(err) {
  if (isNoSignal(err)) return NO_SIGNAL;
  if (err.code === 'invalid_credentials' || /invalid login credentials/i.test(String(err.message || ''))) {
    return 'That current password isn’t right.';
  }
  if (err.status === 429 || err.code === 'over_request_rate_limit') {
    return 'Too many tries in a row. Wait a few minutes, then try again.';
  }
  return `Couldn’t check your current password: ${err.message || 'unknown error'}. Nothing was changed.`;
}

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

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError(NO_SIGNAL);
      return;
    }

    setBusy(true);
    try {
      blockInDemo('Changing your password');
      const { db } = await loadModule(() => import('../archive/archiveClient'));

      /* Verify the current password by actually using it. Same account, so
         this just refreshes the session -- but a wrong password fails here,
         before anything is changed. */
      const { error: signInErr } = await db.auth.signInWithPassword({ email, password: current });
      if (signInErr) throw new Error(signInMessage(signInErr));

      const { error: updErr } = await db.auth.updateUser({ password: next });
      if (updErr) {
        throw new Error(isNoSignal(updErr)
          ? 'Lost signal while changing it, so it may not have gone through. Try again when you have signal — if the new one does not work, your old password still does.'
          : updErr.message);
      }

      reset();
      setDone(true);
      setOpen(false);
      setTimeout(() => setDone(false), 4000);
    } catch (ex) {
      // A raw "Failed to fetch" TypeError is the network, not the password.
      setError(ex instanceof TypeError ? NO_SIGNAL : (ex?.message || 'Could not change it. Check your signal and try again.'));
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
