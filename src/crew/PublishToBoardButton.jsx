import { useState } from 'react';
import { loadModule } from '../shared/loadModule';

/* ── "Publish to my board" ────────────────────────────────────────────────
   Like FileToArchiveButton, this deliberately imports NO cloud code up
   front -- board.js and the Supabase library it pulls in arrive through a
   dynamic import() at the moment somebody taps, so building a JSA stays
   login-free and offline.

   This is a different moment from filing to the archive, and the order
   matters: publish BEFORE the tailgate meeting so the crew can sign, file
   AFTER everyone has signed so the stored PDF actually has signatures on
   it. Publishing locks the JSA -- revising means publishing a new version,
   and whoever signed the old one stays attached to it. */

export default function PublishToBoardButton({ jsa, pdfBlob, pdfPending, disabled, onPublished }) {
  const [phase, setPhase] = useState('idle'); // idle | needsSignIn | working | published | error
  const [message, setMessage] = useState('');
  const [boardUrl, setBoardUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [warning, setWarning] = useState(null);

  /* Checks the shift length before anything is published, because the
     cheapest place to catch a mistyped time is before fifty men can see
     it. Loads the board module to do the same expiry maths the server
     will, rather than a second copy of the rule that can drift from it. */
  async function startPublish() {
    setMessage('');
    try {
      const { windowHours, LONG_WINDOW_HOURS, describeWindow, computeExpiry } =
        await loadModule(() => import('./board'));
      const hours = windowHours(jsa);
      if (hours > LONG_WINDOW_HOURS) {
        setWarning({
          hours: Math.round(hours),
          until: describeWindow(computeExpiry(jsa)),
          ends: jsa?.timeExpired || '',
        });
        return;
      }
    } catch {
      /* If the check itself can't load, publishing still works -- a
         warning is a nicety and must never be the thing that stops a
         crew signing in. */
    }
    await publish();
  }

  async function publish() {
    setWarning(null);
    setPhase('working');
    setMessage('');
    try {
      const { publishToBoard, NotSignedInError } = await loadModule(() => import('./board'));
      try {
        const { boardUrl: url } = await publishToBoard({ jsa, pdfBlob });
        setBoardUrl(url);
        setPhase('published');
        /* Straight to the board. Publishing isn't the end of the job --
           watching the count come in is, and the QR and the kiosk live
           there too. This screen used to say "published" and show a URL,
           which left a man to navigate to the thing he obviously wanted
           next. Fonzo's call, 2026-09-10.

           Short pause so the confirmation registers rather than the screen
           appearing to jump on its own. */
        if (onPublished) setTimeout(onPublished, 900);
      } catch (err) {
        if (err instanceof NotSignedInError || err?.name === 'NotSignedInError') {
          setPhase('needsSignIn');
          return;
        }
        throw err;
      }
    } catch (err) {
      setMessage(err?.message || 'Could not publish it. Check your connection and try again.');
      setPhase('error');
    }
  }

  async function signInThenPublish(e) {
    e.preventDefault();
    setPhase('working');
    setMessage('');
    try {
      const { db } = await loadModule(() => import('../archive/archiveClient'));
      const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message);
      await publish();
    } catch (err) {
      setMessage(err?.message || 'Could not sign in. Try again.');
      setPhase('needsSignIn');
    }
  }

  if (phase === 'published') {
    return (
      <div className="archiveFiled">
        <strong>Live on your board</strong>
        <span>The crew can scan and sign it now. It&apos;s locked — to change it, publish a revision.</span>
        <p className="helperText" style={{ wordBreak: 'break-all', marginTop: 8 }}>{boardUrl}</p>
      </div>
    );
  }

  if (phase === 'needsSignIn') {
    return (
      <form className="archiveSignIn" onSubmit={signInThenPublish}>
        <strong>Sign in to publish this</strong>
        <span className="helperText">Only needed to publish. Building a JSA never asks for a login.</span>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="archiveError">{message}</p>}
        <button type="submit" className="btn primary">Sign in and publish</button>
      </form>
    );
  }

  return (
    <div className="archiveFileRow">
      <button
        type="button"
        className="btn primary lg"
        onClick={startPublish}
        disabled={disabled || pdfPending || phase === 'working'}
      >
        {phase === 'working' ? 'Publishing…' : pdfPending ? 'Getting the document ready…' : 'Publish to my board'}
      </button>
      {phase === 'error' && <p className="archiveError">{message}</p>}
      <p className="helperText">
        Puts this JSA on your board so the crew can scan the QR and sign it.
        Publishing locks it — to change it afterwards, publish a revision.
      </p>

      {/* The 5:00 PM / 5:00 AM catch. States the length out loud, because
          the length is the part nobody looks at and the only part that
          makes a mistyped time obvious. Never blocks -- he can publish a
          genuinely long window straight through it. */}
      {warning && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setWarning(null); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Check the times" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: 0 }}>That&apos;s a {warning.hours}-hour shift</h3>
            <p className="helperText">
              This JSA would stay open until <strong>{warning.until}</strong>.
            </p>
            <p className="helperText">
              Time Expired is set to <strong>{warning.ends}</strong>. If the crew finishes in the
              morning, that should be an AM time — 05:00, not 17:00.
            </p>
            <div className="dialogActions">
              <button type="button" className="btn ghost" onClick={() => setWarning(null)}>
                Let me fix it
              </button>
              <button type="button" className="btn primary" onClick={publish}>
                It&apos;s right — publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
