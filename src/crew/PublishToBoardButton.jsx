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

export default function PublishToBoardButton({ jsa, pdfBlob, pdfPending, disabled }) {
  const [phase, setPhase] = useState('idle'); // idle | needsSignIn | working | published | error
  const [message, setMessage] = useState('');
  const [boardUrl, setBoardUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function publish() {
    setPhase('working');
    setMessage('');
    try {
      const { publishToBoard, NotSignedInError } = await loadModule(() => import('./board'));
      try {
        const { boardUrl: url } = await publishToBoard({ jsa, pdfBlob });
        setBoardUrl(url);
        setPhase('published');
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
        onClick={publish}
        disabled={disabled || pdfPending || phase === 'working'}
      >
        {phase === 'working' ? 'Publishing…' : pdfPending ? 'Getting the document ready…' : 'Publish to my board'}
      </button>
      {phase === 'error' && <p className="archiveError">{message}</p>}
      <p className="helperText">
        Puts this JSA on your board so the crew can scan the QR and sign it.
        Publishing locks it — to change it afterwards, publish a revision.
      </p>
    </div>
  );
}
