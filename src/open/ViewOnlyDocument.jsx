import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import { DocFacsimile } from '../documents/FormPrimitives';
import { disciplinaryFacsimileBlocks } from '../documents/disciplinary/disciplinaryPdfDraw';
import { separationFacsimileBlocks } from '../documents/separation/separationPdfDraw';
import { medicalEventFacsimileBlocks } from '../documents/medicalEvent/medicalEventPdfDraw';
import { uncontrolledEventFacsimileBlocks } from '../documents/uncontrolledEvent/uncontrolledEventPdfDraw';
import { IncidentPdfExportRoot } from '../incident/incidentPdfGenerate';
import '../incident/incident.css';

/* ── Looking at a document that is waiting for sign-off ───────────────────
   Fonzo, 2026-09-28: "when you submit something for review and you open it
   again, it creates it as a draft, that's a no no, you can open something
   that's up for review but you cannot edit or anything, the boxes are
   locked, bc no one knows that it's created a brand new doc, they think
   they're editing the one that they submitted."

   Opening used to copy the document into the device's draft slot as an
   editable draft -- replacing whatever was already there, and leaving the
   copy that is actually waiting for review untouched by anything typed.
   This shows it instead. Nothing is written to the device, so there is no
   second copy to be confused by and nothing already on the iPad is lost.

   Approvers still open it the old way, into the workflow, because fixing a
   typo before filing is theirs to do (Fonzo, 2026-09-11) -- see
   OpenDocsView. */

const FORMS = {
  disciplinary: { title: 'Employee Disciplinary Notice Form', blocks: disciplinaryFacsimileBlocks },
  separation: { title: 'Employee Separation Form', blocks: separationFacsimileBlocks },
  medicalEvent: { title: 'Employee Medical Event Form', blocks: medicalEventFacsimileBlocks },
  uncontrolledEvent: { title: 'Uncontrolled Event Report', blocks: uncontrolledEventFacsimileBlocks },
};

/* The Incident report's real pages -- the same ones the PDF is made from,
   normally drawn off-screen -- shown scaled to fit. */
function IncidentPages({ incident }) {
  const wrapRef = useRef(null);
  const pageRefsRef = useRef([]);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const update = () => setScale(Math.min(1, Math.max(280, node.clientWidth) / 816));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="vodIncident" ref={wrapRef} style={{ '--vod-scale': scale }}>
      <IncidentPdfExportRoot incident={incident} pageRefsRef={pageRefsRef} />
    </div>
  );
}

export default function ViewOnlyDocument({ row, label, onClose }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = await loadModule(() => import('./openDocs'));
        const full = await mod.getOpenDocument(row.id);
        if (alive) setDoc(full?.data || {});
      } catch (ex) {
        if (alive) setError(ex?.message || 'Could not open it. Check your signal and try again.');
      }
    })();
    return () => { alive = false; };
  }, [row.id]);

  const form = FORMS[row.doc_type];

  return (
    <div className="vodOverlay" role="dialog" aria-modal="true" aria-label="View only">
      <div className="vodPanel">
        <header className="vodHead">
          <div>
            <span className="vodKicker">{label}</span>
            <strong className="vodTitle">{row.employee_name || row.job_site || 'Untitled'}</strong>
          </div>
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </header>
        <p className="vodNotice">
          <strong>View only — waiting for sign-off.</strong> Nothing can be changed while it waits.
          If something needs fixing, ask the approver to send it back to you.
        </p>
        <div className="vodBody">
          {error && <p className="archiveError">{error}</p>}
          {!doc && !error && <p className="helperText">Opening…</p>}
          {doc && form && <DocFacsimile formTitle={form.title} draft blocks={form.blocks(doc)} />}
          {doc && row.doc_type === 'incident' && <IncidentPages incident={doc} />}
          {doc && !form && row.doc_type !== 'incident' && (
            <p className="helperText">This kind of document can&apos;t be shown here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
