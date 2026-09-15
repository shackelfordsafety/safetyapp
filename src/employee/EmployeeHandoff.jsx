import { useCallback, useEffect, useState } from 'react';
import { db } from '../archive/archiveClient';
import { DocFacsimile, SignaturePad } from '../documents/FormPrimitives';
import { disciplinaryFacsimileBlocks } from '../documents/disciplinary/disciplinaryPdfDraw';
import { separationFacsimileBlocks } from '../documents/separation/separationPdfDraw';
import './employee.css';

/* ── What the employee has to do, on the employee's own phone ────────────
   Fonzo, 2026-09-15: "management does their own stuff. And then once they
   finish their part... it gets to a step in the workflow where it's like,
   okay, this is what the employee needs to do, and it scans a QR code, and
   it gives them everything he needs to do... everything that an employee
   needs to do goes under one QR code."

   And why his phone rather than the company iPad, in his words: "just in
   case they're disgruntled or upset or whatever, they can't, like, trash
   the iPad."

   HE SEES THE WHOLE NOTICE FIRST. Fonzo: "they can even get something that
   shows them what they're signing and all that, like the JSA." The crew
   page already works this way, and it matters more here -- he is
   acknowledging receipt of an accusation, and a signature on something the
   signer could not read is the kind of detail that gets a write-up thrown
   out. The facsimile rendered below is the same block list the printed PDF
   is drawn from, so what he reads is what gets filed.

   This person has no account and never will. Like the crew page, it mounts
   INSTEAD of the app -- he never downloads a document builder. */

const RENDERERS = {
  disciplinary: { title: 'EMPLOYEE DISCIPLINARY NOTICE FORM', blocks: disciplinaryFacsimileBlocks },
  separation: { title: 'EMPLOYEE SEPARATION FORM', blocks: separationFacsimileBlocks },
};

function Waiting({ children }) {
  return <div className="empWrap"><div className="empCard"><p className="empMuted">{children}</p></div></div>;
}

export default function EmployeeHandoff({ token }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [statement, setStatement] = useState('');
  const [signature, setSignature] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await db.rpc('employee_request_for', { t: token });
      if (err) throw new Error(err.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setState({ phase: 'gone' }); return; }
      setState({ phase: 'ready', row });
    } catch (ex) {
      setState({ phase: 'error', message: ex?.message || 'Could not open this.' });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    setSending(true);
    setError('');
    try {
      const { error: err } = await db.rpc('submit_employee_response', {
        t: token,
        in_statement: statement,
        in_signature: signature,
      });
      if (err) throw new Error(err.message);
      setState({ phase: 'done' });
    } catch (ex) {
      setError(ex?.message || 'Could not send it. Check your signal and try again.');
    } finally {
      setSending(false);
    }
  }

  if (state.phase === 'loading') return <Waiting>Opening&hellip;</Waiting>;

  /* Expired, already signed, or a link somebody invented. Deliberately one
     message for all three: telling a stranger which of those it was tells
     them something about a document that is none of their business. */
  if (state.phase === 'gone') {
    return (
      <div className="empWrap">
        <div className="empCard">
          <h1 className="empTitle">This link is no longer open</h1>
          <p>It may have already been signed, or it may have expired. Ask whoever gave it to you for a new one.</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="empWrap">
        <div className="empCard">
          <h1 className="empTitle">Something went wrong</h1>
          <p>{state.message}</p>
          <button type="button" className="btn primary" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  if (state.phase === 'done') {
    return (
      <div className="empWrap">
        <div className="empCard empDone">
          <h1 className="empTitle">Sent</h1>
          <p>
            Your statement and signature have gone back to the company. You can
            close this page &mdash; this link will not open again.
          </p>
        </div>
      </div>
    );
  }

  const { row } = state;
  const renderer = RENDERERS[row.doc_type];
  const needs = row.needs || [];
  const wantsStatement = needs.includes('statement');
  const wantsSignature = needs.includes('signature');
  const ready = (!wantsSignature || Boolean(signature));

  return (
    <div className="empWrap">
      <div className="empCard">
        <h1 className="empTitle">{row.employee_name ? `${row.employee_name}, please read this` : 'Please read this'}</h1>
        <p className="empMuted">
          {row.requested_by_name ? `${row.requested_by_name} has asked you to read and sign the following.` : 'You have been asked to read and sign the following.'}
        </p>
      </div>

      {/* The document itself, drawn from the same blocks the printed copy
          is drawn from. Not a summary of it. */}
      <div className="empCard empDoc">
        {renderer
          ? <DocFacsimile formTitle={renderer.title} blocks={renderer.blocks(row.document || {})} />
          : <p className="empMuted">This document cannot be shown on a phone. Ask for a paper copy.</p>}
      </div>

      {wantsStatement && (
        <div className="empCard">
          <h2 className="empHeading">Anything you want to say about this?</h2>
          <p className="empMuted">
            This is your statement, in your words. It prints on the notice exactly
            as you type it. You can leave it empty.
          </p>
          <textarea
            className="empTextarea"
            rows={6}
            value={statement}
            onChange={e => setStatement(e.target.value)}
            placeholder="Your side of it, if you want to give one."
          />
        </div>
      )}

      {wantsSignature && (
        <div className="empCard">
          <h2 className="empHeading">Your signature</h2>
          <p className="empMuted">
            Signing means you received this notice. It does <strong>not</strong> mean you
            agree with it.
          </p>
          <SignaturePad label="" value={signature} onChange={setSignature} />
        </div>
      )}

      <div className="empCard empSubmit">
        {error && <p className="empError">{error}</p>}
        <button
          type="button"
          className="btn primary lg empSend"
          onClick={send}
          disabled={sending || !ready}
        >
          {sending ? 'Sending…' : 'Send it back'}
        </button>
        {!ready && <p className="empMuted">Add your signature above first.</p>}
        <p className="empMuted">You only get to send this once.</p>
      </div>
    </div>
  );
}
