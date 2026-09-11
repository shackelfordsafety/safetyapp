import { useState } from 'react';
import { loadModule } from '../shared/loadModule';
import '../archive/fileButton.css';

/* ── "Send it for review" ────────────────────────────────────────────────
   The move that was missing. A superintendent or a safety coordinator
   finishes a document and cannot file it -- deliberately, because the
   person who writes a report should not also be the person who decides it
   is final. Fonzo, 2026-09-11: "even a safety can still shoot the company
   in the foot if we're trying to work in the gray area... it's up to the
   PM or the owners to be like, okay. This is good, and then they'll file
   it."

   Without this button that rule just reads as "you are blocked". With it
   the rule is a workflow: you send it up, somebody with the authority
   looks at it, and they either file it or send it back with a reason.

   Same shape as FileToArchiveButton on purpose -- no Supabase import at
   the top, everything cloud-side pulled in with a dynamic import() at the
   moment somebody taps, so this can sit inside the ordinary non-lazy
   workflows without dragging auth and network code into the bundle every
   superintendent downloads.

   The PDF goes up WITH it. The approver never opens the workflow -- he
   sees a row on a list and decides -- so the printed document has to
   already exist, made by the man who wrote it, from what he actually saw.
   See submitForSignOff in openDocs.js. */

/* Said in the words of the job, not the words of the table. Mirrors
   can_file_doc_type() in the database, which is what actually enforces
   it -- this only tells somebody where his document is going. */
const GOES_TO = {
  incident: 'a PM or an owner',
  medicalEvent: 'a PM or an owner',
  uncontrolledEvent: 'a PM or an owner',
  disciplinary: 'HR or an owner',
  separation: 'HR or an owner',
  jsa: 'a PM or an owner',
};

export default function SendForReviewButton({ docType, model, pdfBlob, ensurePdf, disabled, onHandedOff }) {
  const [phase, setPhase] = useState('idle'); // idle | needsSignIn | working | making | sent | error
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const goesTo = GOES_TO[docType] || 'a PM or an owner';

  async function send() {
    setMessage('');
    try {
      /* One button, not three. Fonzo, 2026-09-11: "once they're done they
         click one button 'submit'". Making the printout was a separate tap
         before this, and then downloading it was another, and only then
         could you send it -- three actions for one intention. If the PDF
         does not exist yet this makes it first. */
      let blob = pdfBlob;
      if (!blob && ensurePdf) {
        setPhase('making');
        blob = await ensurePdf();
        if (!blob) {
          setMessage('The printout could not be made, so nothing was sent. Try again.');
          setPhase('error');
          return;
        }
      }
      setPhase('working');
      const mod = await loadModule(() => import('./openDocs'));
      try {
        /* Two steps and they have to be in this order: the row has to
           exist before it can be submitted against. shareOpenDocument is
           an upsert on the id it returns, so tapping this twice does not
           make two documents. */
        const { id } = await mod.shareOpenDocument({ id: null, docType, model });
        await mod.submitForSignOff({ id, pdfBlob: blob, note });
        /* Hand it off. It stops being this device's unfinished work the
           moment somebody else owns what happens next -- Fonzo, 2026-09-11,
           after a clerk kept seeing a form he had already sent up and kept
           thinking he still owed somebody something: "soon as someone hits
           submit for review or whatever, it needs to disappear".

           The caller clears the workflow's own state too; storage alone is
           not enough, because the 900ms autosave would write the draft
           straight back from memory. */
        onHandedOff?.(model);
        setPhase('sent');
      } catch (err) {
        if (err instanceof mod.NotSignedInError || err?.name === 'NotSignedInError') {
          setPhase('needsSignIn');
          return;
        }
        throw err;
      }
    } catch (err) {
      setMessage(err?.message || 'Could not send it. Check your connection and try again.');
      setPhase('error');
    }
  }

  async function signInThenSend(e) {
    e.preventDefault();
    setPhase('working');
    setMessage('');
    try {
      const { signInToArchive } = await loadModule(() => import('../archive/fileToArchive'));
      await signInToArchive(email, password);
      await send();
    } catch (err) {
      setMessage(err?.message || 'Could not sign in. Try again.');
      setPhase('needsSignIn');
    }
  }

  if (phase === 'sent') {
    return (
      <div className="archiveFiled">
        <strong>Sent for review</strong>
        <span>
          It&apos;s with {goesTo} now and it has left this device, so there is
          nothing more for you to do with it. You can see where it got to under
          My Work.
        </span>
      </div>
    );
  }

  if (phase === 'needsSignIn') {
    return (
      <form className="archiveSignIn" onSubmit={signInThenSend}>
        <strong>Sign in to send this for review</strong>
        <span className="helperText">Only needed to send it. Filling out documents never asks for a login.</span>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="archiveError">{message}</p>}
        <button type="submit" className="btn primary">Sign in and send</button>
      </form>
    );
  }

  return (
    <div className="archiveFileRow">
      <label className="field">
        <span>Anything they should know? (optional)</span>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Still waiting on the witness statement"
          maxLength={200}
        />
      </label>
      <button
        type="button"
        className="btn primary lg"
        onClick={send}
        disabled={disabled || phase === 'working' || phase === 'making'}
      >
        {phase === 'making' ? 'Making the printout…' : phase === 'working' ? 'Sending…' : 'Submit for review'}
      </button>
      {phase === 'error' && <p className="archiveError">{message}</p>}
      <p className="helperText">
        Goes to {goesTo} to look over and file. It leaves this device when you
        send it &mdash; you can see where it got to under My Work.
      </p>
    </div>
  );
}
