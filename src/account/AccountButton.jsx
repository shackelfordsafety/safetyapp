import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './account.css';
import { readStoredSession, onSessionChanged, notifySessionChanged } from '../shared/session';

/* ── Who you are, top right, always visible ──────────────────────────────
   Fonzo's model: "sign in once and forget about it. logging in unlocks
   more features for you basically." So this is a STATUS INDICATOR first
   and a door second. It never blocks anything -- the app opens, builds and
   finishes any document with no account and no signal. Signing in adds
   publishing, filing to the archive, and browsing it.

   WHY THIS READS localStorage DIRECTLY instead of asking Supabase:
   rendering a "you are signed in" chip must not cost 59 kB of auth library
   on every cold start, which would drag cloud code into the bundle every
   superintendent downloads and break the offline-first promise. The saved
   session is already sitting in localStorage, so we read the email out of
   it with no library at all. That also means the chip is correct offline,
   with no network round trip.

   The library is only ever loaded when somebody actually taps to sign in
   or out. */

/* readStoredSession is imported rather than kept here. A private copy sat
   in this file until 2026-09-12, even though shared/session.js says in its
   own header that it exists so "the two can never disagree about whether
   somebody is signed in" -- which was not true while there were two of
   them. One copy now, and the header is honest. */

export default function AccountButton() {
  const [session, setSession] = useState(readStoredSession);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => setSession(readStoredSession()), []);

  /* Signing in from somewhere else -- the Records screen, or the publish
     button's own inline form -- updates this without a reload.

     It used to listen for 'storage' and 'focus' only, and neither ever
     fires for that: a storage event reaches every tab EXCEPT the one that
     made the change, and focus does not move when you sign in on a screen
     you are already looking at. So this chip sat reading "Guest — Sign in"
     at somebody who was signed in and reading their own records.
     onSessionChanged keeps both of those and adds the one signal that
     actually fires. */
  useEffect(() => onSessionChanged(refresh), [refresh]);

  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { error: err } = await db.auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError(err.message); return; }
      notifySessionChanged();
      refresh();
      setOpen(false);
      setPassword('');
    } catch (ex) {
      setError(ex?.message || 'Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  /* Signing out takes the paperwork with you. HR signed out on a shared
     device 2026-09-11 and her half-written separation form was still sitting
     there for whoever picked it up -- localStorage is per DEVICE, so on the
     one iPad in a job trailer "signed out" meant nothing at all.

     Asked first, and only when there is genuinely something to lose, with
     the documents named. Somebody who has spent twenty minutes on an
     incident report deserves to be told before it goes, not after. */
  async function signOut() {
    const { unfinishedOnThisDevice, clearWorkFromThisDevice } = await import('../shared/clearOnSignOut');
    const unfinished = unfinishedOnThisDevice();
    if (unfinished.length) {
      const list = unfinished.map(x => `  • ${x}`).join('\n');
      const ok = window.confirm(
        `Signing out removes unfinished paperwork from this device:\n\n${list}\n\n`
        + 'This is so the next person to pick it up cannot read it. Anything you '
        + 'have already submitted is safe on your account.\n\nSign out and remove it?'
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      await db.auth.signOut();
      notifySessionChanged();
    } catch { /* clearing the local session below is what actually matters */ }
    clearWorkFromThisDevice();
    refresh();
    setSession(null);
    setBusy(false);
    setOpen(false);
    /* Reloaded rather than re-rendered: every workflow holds its document
       in React state, and clearing storage under a mounted form would let
       its 900ms autosave write the whole thing straight back. */
    window.location.reload();
  }

  return (
    <>
      <button
        type="button"
        className={`acctChip${session ? ' signedIn' : ''}`}
        onClick={() => { setOpen(true); setError(''); }}
      >
        {session
          ? <><span className="acctDot" aria-hidden="true" />{session.email}</>
          : <>Guest — <strong>Sign in</strong></>}
      </button>

      {open && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Account" style={{ maxWidth: 420 }}>
            {session ? (
              <>
                <h3 style={{ margin: 0 }}>Signed in</h3>
                <p className="helperText">{session.email}</p>
                <p className="helperText">
                  Signing out doesn&apos;t affect anything on this device. You can still build
                  and finish documents — you just can&apos;t publish or open Records.
                </p>
                <div className="dialogActions">
                  <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
                  <button type="button" className="btn primary" onClick={signOut} disabled={busy}>
                    {busy ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={signIn}>
                <h3 style={{ margin: 0 }}>Sign in</h3>
                <p className="helperText">
                  Only needed to publish a JSA to your board or open Records.
                  Building documents never asks for this.
                </p>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
                {error && <p className="archiveError">{error}</p>}
                <div className="dialogActions">
                  <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
