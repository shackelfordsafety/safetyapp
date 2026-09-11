import { useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import SendForReviewButton from './SendForReviewButton';
import ApproveAndFileButton from './ApproveAndFileButton';

/* ── One decision, one button ────────────────────────────────────────────
   Submit for review and Approve & file used to be two independent
   components that knew nothing about each other, so both could be on
   screen at once and neither knew which one was right.

   Fonzo, 2026-09-11: "pat's side is still saying submit for review even
   tho she's the one reviewing and approving". And it cost something real
   the same afternoon: HR corrected a separation form, saw only "Submit for
   review", used it, and the document came back round as though she had
   written it -- the clerk who actually wrote it lost his name on it.

   So the decision is made ONCE, here:

     an approver holding a document that is waiting for sign-off
       -> Approve & file, and nothing else
     everybody else
       -> Submit for review

   Never both. A screen that offers two ways to finish is a screen that
   picks the wrong one for you. */

const APPROVERS = {
  incident: ['pm', 'hr', 'owner'],
  medicalEvent: ['pm', 'hr', 'owner'],
  uncontrolledEvent: ['pm', 'hr', 'owner'],
  disciplinary: ['hr', 'owner'],
  separation: ['hr', 'owner'],
};

export default function SubmitArea({ docType, model, pdfBlob, ensurePdf, disabled, onHandedOff }) {
  const [mode, setMode] = useState('unknown'); // unknown | submit | approve

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mod = await loadModule(() => import('./openDocs'));
        const who = await mod.whoAmI();
        const canApprove = (APPROVERS[docType] || []).includes(who?.role) || who?.is_admin;
        if (!canApprove) { if (!dead) setMode('submit'); return; }

        /* Is THIS document actually waiting on them? Being an approver is
           not enough -- an HR person writing her own separation form is
           submitting it like anybody else. */
        const waitingId = await mod.findSubmittedDocumentFor(docType, model?.id);
        if (dead) return;
        setMode(waitingId ? 'approve' : 'submit');
      } catch {
        /* Signed out, or no signal. Submitting is the safe default: it is
           what somebody with no special standing would get, and it cannot
           file anything. */
        if (!dead) setMode('submit');
      }
    })();
    return () => { dead = true; };
  }, [docType, model?.id]);

  /* Nothing at all until it is known which one is right. A button that
     appears and then changes into a different button under somebody's
     thumb is worse than a moment of blank space. */
  if (mode === 'unknown') return null;

  if (mode === 'approve') {
    return <ApproveAndFileButton docType={docType} model={model} />;
  }

  return (
    <>
      <SendForReviewButton
        docType={docType}
        model={model}
        pdfBlob={pdfBlob}
        ensurePdf={ensurePdf}
        disabled={disabled}
        onHandedOff={onHandedOff}
      />
      {disabled && (
        <p className="helperText">Finish the list above before sending it up.</p>
      )}
    </>
  );
}
