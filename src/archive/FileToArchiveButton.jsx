import { useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './fileButton.css';

/* ── "File to the archive" ────────────────────────────────────────────────
   Deliberately contains NO import of the Supabase library. Everything that
   talks to the cloud is pulled in with a dynamic import() at the moment
   somebody taps the button, so this component can sit inside the ordinary
   (non-lazy) document workflows without dragging ~62 kB of auth and network
   code into the bundle every superintendent downloads.

   Filing is always optional and can never lose work: the document is already
   saved on the device, and a failure here changes nothing about it. If there
   is no signal, or no account, the answer is simply "try again later".

   Signing in appears inline only when it is actually needed. Filling out a
   document never asks for a login; filing a finished one does, because the
   archive has to know whose it is. */

export default function FileToArchiveButton({ docType, model, pdfBlob, disabled }) {
  const [phase, setPhase] = useState('idle'); // idle | needsSignIn | working | filed | error
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function file() {
    setPhase('working');
    setMessage('');
    try {
      const { fileDocument, NotSignedInError } = await loadModule(() => import('./fileToArchive'));
      try {
        await fileDocument({ docType, model, pdfBlob });
        setPhase('filed');
      } catch (err) {
        if (err instanceof NotSignedInError || err?.name === 'NotSignedInError') {
          setPhase('needsSignIn');
          return;
        }
        throw err;
      }
    } catch (err) {
      setMessage(err?.message || 'Could not file it. Check your connection and try again.');
      setPhase('error');
    }
  }

  async function signInThenFile(e) {
    e.preventDefault();
    setPhase('working');
    setMessage('');
    try {
      const { signInToArchive, fileDocument } = await loadModule(() => import('./fileToArchive'));
      await signInToArchive(email, password);
      await fileDocument({ docType, model, pdfBlob });
      setPhase('filed');
    } catch (err) {
      setMessage(err?.message || 'Could not sign in. Try again.');
      setPhase('needsSignIn');
    }
  }

  if (phase === 'filed') {
    return (
      <div className="archiveFiled">
        <strong>Filed to Records</strong>
        <span>Safety and HR can find this now. It can&apos;t be changed or deleted from here.</span>
      </div>
    );
  }

  if (phase === 'needsSignIn') {
    return (
      <form className="archiveSignIn" onSubmit={signInThenFile}>
        <strong>Sign in to file this</strong>
        <span className="helperText">Only needed to file it. Filling out documents never asks for a login.</span>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="archiveError">{message}</p>}
        <button type="submit" className="btn primary">Sign in and file</button>
      </form>
    );
  }

  return (
    <div className="archiveFileRow">
      <button
        type="button"
        className="btn primary lg"
        onClick={file}
        disabled={disabled || phase === 'working'}
      >
        {phase === 'working' ? 'Filing…' : 'File to Records'}
      </button>
      {phase === 'error' && <p className="archiveError">{message}</p>}
      <p className="helperText">
        Sends a copy to the company archive so Safety and HR can find it later.
        Your copy on this device stays exactly as it is.
      </p>
    </div>
  );
}
