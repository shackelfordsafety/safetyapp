import { useCallback, useEffect, useState } from 'react';
import { db } from '../archive/archiveClient';
import { DocFacsimile, SignaturePad } from '../documents/FormPrimitives';
import { disciplinaryFacsimileBlocks } from '../documents/disciplinary/disciplinaryPdfDraw';
import { separationFacsimileBlocks } from '../documents/separation/separationPdfDraw';
import { medicalEventFacsimileBlocks } from '../documents/medicalEvent/medicalEventPdfDraw';
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
  medicalEvent: { title: 'EMPLOYEE MEDICAL EVENT FORM', blocks: medicalEventFacsimileBlocks },
};

/* What the screen says, per kind of request. A notice is signed to say you
   RECEIVED it; a medical form to say it's accurate as far as you know; a
   witness statement is your own account. Telling a witness "signing means
   you received this notice" would be nonsense. */
const NOTICE_COPY = {
  asked: 'has asked you to read and sign the following.',
  askedAnon: 'You have been asked to read and sign the following.',
  statementHeading: 'Anything you want to say about this?',
  statementHelp: 'This is your statement, in your words. It prints on the notice exactly as you type it. You can leave it empty.',
  statementPlaceholder: 'Your side of it, if you want to give one.',
  signatureHelp: <>Signing means you received this notice. It does <strong>not</strong> mean you agree with it.</>,
  statementRequired: false,
  sent: 'Your statement and signature have gone back to the company.',
};
const COPY = {
  disciplinary: NOTICE_COPY,
  separation: NOTICE_COPY,
  medicalEvent: {
    ...NOTICE_COPY,
    signatureHelp: 'Signing means you have read this form. If something on it is wrong, tell whoever gave you this link before you sign.',
    sent: 'Your signature has gone back to the company.',
  },
  incidentWitness: {
    asked: 'has asked you for a witness statement about the incident below.',
    askedAnon: 'You have been asked for a witness statement about the incident below.',
    statementHeading: 'What did you see?',
    statementHelp: 'In your own words: what you saw and heard, in the order it happened. Stick to what you saw yourself. It prints on the incident report exactly as you type it.',
    statementPlaceholder: 'What you saw happen.',
    signatureHelp: 'Signing means this statement is true to the best of your knowledge.',
    statementRequired: true,
    sent: 'Your statement and signature have gone back to the company.',
  },
};

function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : (iso || '');
}

function fmtTime(hm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return hm || '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/* All a witness is shown: which incident this is. Nothing about who got
   hurt or how -- see witnessHandoffSnapshot in IncidentWorkflow. */
function WitnessIncidentSummary({ doc }) {
  const rows = [
    ['Date', fmtDay(doc.incidentDate)],
    ['Time', fmtTime(doc.incidentTime)],
    ['Workplace', doc.workplaceLocation],
    ['Where exactly', doc.incidentSpecificLocation],
  ].filter(([, v]) => String(v || '').trim());
  return (
    <>
      <h2 className="empHeading">Incident</h2>
      {rows.length
        ? <dl className="empFacts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        : <p className="empMuted">Ask whoever gave you this link which incident it is about.</p>}
    </>
  );
}

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
      setState({ phase: 'done', sent: (COPY[state.row?.doc_type] || NOTICE_COPY).sent });
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
            {state.sent} You can close this page &mdash; this link will not open again.
          </p>
        </div>
      </div>
    );
  }

  const { row } = state;
  const renderer = RENDERERS[row.doc_type];
  const copy = COPY[row.doc_type] || NOTICE_COPY;
  const isWitness = row.doc_type === 'incidentWitness';
  const needs = row.needs || [];
  const wantsStatement = needs.includes('statement');
  const wantsSignature = needs.includes('signature');
  const statementMissing = wantsStatement && copy.statementRequired && !statement.trim();
  const ready = (!wantsSignature || Boolean(signature)) && !statementMissing;

  return (
    <div className="empWrap">
      <div className="empCard">
        <h1 className="empTitle">
          {isWitness
            ? (row.employee_name ? `${row.employee_name}, your witness statement` : 'Your witness statement')
            : (row.employee_name ? `${row.employee_name}, please read this` : 'Please read this')}
        </h1>
        <p className="empMuted">
          {row.requested_by_name ? `${row.requested_by_name} ${copy.asked}` : copy.askedAnon}
        </p>
      </div>

      {/* The document itself, drawn from the same blocks the printed copy
          is drawn from. Not a summary of it. A witness gets only which
          incident it is -- the report is not theirs to read. */}
      <div className="empCard empDoc">
        {isWitness
          ? <WitnessIncidentSummary doc={row.document || {}} />
          : renderer
            ? <DocFacsimile formTitle={renderer.title} blocks={renderer.blocks(row.document || {})} />
            : <p className="empMuted">This document cannot be shown on a phone. Ask for a paper copy.</p>}
      </div>

      {wantsStatement && (
        <div className="empCard">
          <h2 className="empHeading">{copy.statementHeading}</h2>
          <p className="empMuted">{copy.statementHelp}</p>
          <textarea
            className="empTextarea"
            rows={6}
            value={statement}
            onChange={e => setStatement(e.target.value)}
            placeholder={copy.statementPlaceholder}
          />
        </div>
      )}

      {wantsSignature && (
        <div className="empCard">
          <h2 className="empHeading">Your signature</h2>
          <p className="empMuted">{copy.signatureHelp}</p>
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
        {!ready && (
          <p className="empMuted">
            {statementMissing ? 'Write your statement above first.' : 'Add your signature above first.'}
          </p>
        )}
        <p className="empMuted">You only get to send this once.</p>
      </div>
    </div>
  );
}
