import { useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import '../archive/fileButton.css';

/* ── "Approve & file" ────────────────────────────────────────────────────
   For the person at the end of the line. Fonzo, 2026-09-11, watching HR
   send a separation form back to a clerk because one word was wrong:
   "she's the final person why can't she just file it after making the
   changes". No reason at all. So now she can.

   It shows ONLY when all three are true:
     this document was picked up from the review queue,
     the person looking at it is allowed to approve that kind of document,
     and it is still waiting for sign-off.

   Which means an author never sees it, and an approver reading somebody
   else's incident report on his own device never sees it either.

   What it does, in one tap: records exactly what words changed and tells
   the author, redraws the printout from the APPROVED wording with the
   DRAFT stamp gone, and files it. The DRAFT stamp coming off is the
   approver's act, and here it literally is. */

const APPROVERS = {
  incident: ['pm', 'hr', 'owner'],
  medicalEvent: ['pm', 'hr', 'owner'],
  uncontrolledEvent: ['pm', 'hr', 'owner'],
  disciplinary: ['hr', 'owner'],
  separation: ['hr', 'owner'],
};

export default function ApproveAndFileButton({ docType, model }) {
  const [link, setLink] = useState(null);
  const [me, setMe] = useState(null);
  const [canDraw, setCanDraw] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { readPickedUpLink } = await loadModule(() => import('./pickUp'));
        const found = readPickedUpLink();
        if (!found || found.docType !== docType) return;
        const mod = await loadModule(() => import('./openDocs'));
        const who = await mod.whoAmI();
        if (dead) return;
        setLink(found);
        setMe(who);
        setCanDraw(mod.canApproveWithoutTheForm(docType));
      } catch {
        /* Not signed in, or nothing picked up. Either way this button
           simply is not for this person right now. */
      }
    })();
    return () => { dead = true; };
  }, [docType]);

  const allowed = link && me && (APPROVERS[docType] || []).includes(me.role);
  if (!allowed) return null;

  if (!canDraw) {
    return (
      <p className="helperText">
        You can approve this one from <strong>My Work</strong> once you have finished
        correcting it here and submitted it.
      </p>
    );
  }

  async function approve() {
    setPhase('working');
    setMessage('');
    try {
      const mod = await loadModule(() => import('./openDocs'));
      const { clearPickedUpLink } = await loadModule(() => import('./pickUp'));
      const { changes } = await mod.approveWithEdits({ id: link.openDocumentId, model });
      clearPickedUpLink();
      setMessage(changes.length
        ? `Filed. ${changes.length === 1 ? '1 change was' : `${changes.length} changes were`} recorded and the person who wrote it has been told.`
        : 'Filed. Nothing was changed.');
      setPhase('done');
    } catch (ex) {
      setMessage(ex?.message || 'Could not file it. Check your signal and try again.');
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <div className="archiveFiled">
        <strong>Approved and filed</strong>
        <span>{message} It is in Records now, and cannot be changed or deleted from here.</span>
      </div>
    );
  }

  return (
    <div className="archiveFileRow">
      <button
        type="button"
        className="btn primary lg"
        onClick={approve}
        disabled={phase === 'working'}
      >
        {phase === 'working' ? 'Filing…' : 'Approve & file'}
      </button>
      {phase === 'error' && <p className="archiveError">{message}</p>}
      <p className="helperText">
        Files it as it reads right now, including anything you just corrected.
        The printout is remade without the DRAFT mark, and whoever wrote it is
        told exactly what you changed.
      </p>
    </div>
  );
}
