import { useRef } from 'react';
import {
  UNCONTROLLED_EVENT_STEPS,
  EVENT_CLASSIFICATIONS, EVENT_OUTCOMES, NOTIFICATION_OPTIONS, ATTACHMENT_OPTIONS, OUTCOME_INJURY,
  getUncontrolledEventReadinessChecks, isUncontrolledEventReady, isUncontrolledEventPrintFinal,
  uncontrolledEventStepStatus,
} from './uncontrolledEventModel';
import { uncontrolledEventFacsimileBlocks } from './uncontrolledEventPdfDraw';
import {
  Field, TextAreaField, ChipGroup, StepPanel, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth,
} from '../FormPrimitives';
import { LockedContext } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';

function toggleInList(list, item) {
  return (list || []).includes(item) ? list.filter(x => x !== item) : [...(list || []), item];
}

/* ── Step: Event Info & Classification ── */
function StepEvent({ model, upd, next }) {
  return (
    <StepPanel title="Event Info & Classification" intro="Where and when this happened, and what kind of event it was. Check every classification and outcome that applies.">
      <div className="formSection">
        <span className="formSectionHeading">Event Information</span>
        <div className="formGrid">
          <Field label="Workplace Location / Project" value={model.workplaceLocation} onChange={v => upd({ workplaceLocation: v })} />
          <div className="formPairRow">
            <Field label="Date of Event" type="date" value={model.eventDate} onChange={v => upd({ eventDate: v })} />
            <Field label="Weather / Conditions" value={model.weatherConditions} onChange={v => upd({ weatherConditions: v })} />
          </div>
          <div className="formPairRow">
            <Field label="Date/Time Report Written" type="datetime-local" value={model.reportWrittenDateTime} onChange={v => upd({ reportWrittenDateTime: v })} />
            <Field label="Date/Time Reported to Supervisor" type="datetime-local" value={model.reportedToSupervisorDateTime} onChange={v => upd({ reportedToSupervisorDateTime: v })} />
          </div>
        </div>
      </div>

      <ChipGroup label="Event Classification (check all that apply)" options={EVENT_CLASSIFICATIONS} selected={model.eventClassifications} onToggle={opt => upd({ eventClassifications: toggleInList(model.eventClassifications, opt) })} />
      {(model.eventClassifications || []).includes('Other') && (
        <Field label="Other classification — specify" value={model.eventClassificationOther} onChange={v => upd({ eventClassificationOther: v })} />
      )}

      <ChipGroup label="Outcome / Impact (check all that apply)" options={EVENT_OUTCOMES} selected={model.eventOutcomes} onToggle={opt => upd({ eventOutcomes: toggleInList(model.eventOutcomes, opt) })} />
      {(model.eventOutcomes || []).includes('Other') && (
        <Field label="Other outcome — specify" value={model.eventOutcomeOther} onChange={v => upd({ eventOutcomeOther: v })} />
      )}
      {(model.eventOutcomes || []).includes(OUTCOME_INJURY) && (
        <div className="pdfStaleWarning">
          <strong>Injury/Illness selected.</strong>
          <p>An Incident Report may also be required for an injury/illness — this form does not replace it. Complete the Incident Reporting and Investigation Form separately if applicable.</p>
        </div>
      )}
      <Field label="Estimated Cost (if known)" value={model.estimatedCost} onChange={v => upd({ estimatedCost: v })} />

      <StepFooter hasNext onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Narrative & Notifications ── */
function StepNarrative({ model, upd, prev, next }) {
  return (
    <StepPanel title="Narrative & Notifications" intro="What happened, what was done right away, and who was told.">
      <TextAreaField label="What Happened / Brief Summary / Timeline" rows={6} value={model.whatHappened} onChange={v => upd({ whatHappened: v })} voice />
      <TextAreaField label="What did you do right after this happened?" rows={4} value={model.immediateActionsTaken} onChange={v => upd({ immediateActionsTaken: v })} voice />

      <ChipGroup label="Notifications (check all that apply)" options={NOTIFICATION_OPTIONS} selected={model.notifications} onToggle={opt => upd({ notifications: toggleInList(model.notifications, opt) })} />
      <ChipGroup label="Attachments (check all that apply)" options={ATTACHMENT_OPTIONS} selected={model.attachments} onToggle={opt => upd({ attachments: toggleInList(model.attachments, opt) })} />
      {(model.attachments || []).includes('Other') && (
        <Field label="Other attachment — specify" value={model.attachmentOther} onChange={v => upd({ attachmentOther: v })} />
      )}
      <TextAreaField label="Witnesses" help="Names of any witnesses, one per line. Leave blank if none." rows={2} value={model.witnesses} onChange={v => upd({ witnesses: v })} />

      <div className="formSection">
        <span className="formSectionHeading">Reported By</span>
        <div className="formPairRow">
          <Field label="Reported By — Name" value={model.reportedByName} onChange={v => upd({ reportedByName: v })} />
          <Field label="Reported By — Title" value={model.reportedByTitle} onChange={v => upd({ reportedByTitle: v })} />
        </div>
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Supervisor Review</span>
        <Field label="Supervisor Name" value={model.supervisorReviewName} onChange={v => upd({ supervisorReviewName: v })} />
      </div>

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Review" />
    </StepPanel>
  );
}

/* ── Step: Review — read the whole report over before anyone signs it.
   No Mark Complete here -- that only makes sense after Signatures (see
   Finish & Export below, which is where it actually lives). ── */
function StepReview({ checks, prev, next, onJumpCheck }) {
  const remainingCount = checks.filter(c => !c.ok).length;
  return (
    <StepPanel title="Review" intro="Make sure everything is right before anyone signs. Tap any item below to fix it.">
      <div className="card">
        <div className="cardHeader"><strong>Readiness</strong></div>
        <p className="helperText">
          {remainingCount === 0
            ? 'Everything is filled in. Continue to signatures when ready.'
            : `${remainingCount} ${remainingCount === 1 ? 'item' : 'items'} still needed — tap one to go straight to it.`}
        </p>
        <ReadinessChecklist checks={checks} onJump={onJumpCheck} />
      </div>
      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Signatures" />
    </StepPanel>
  );
}

/* ── Step: Signatures — Reported By and Supervisor Review are both staff
   roles, always digitized (Fonzo, 2026-08-29: "the only thing i wanted
   digitized is the superintendent, foreman, safety parts"). ── */
function StepSignatures({ model, upd, prev, next }) {
  return (
    <StepPanel title="Signatures" intro="Reported By and Supervisor Review sign here.">
      <div className="formSection">
        <span className="formSectionHeading">Reported By</span>
        <div className="formPairRow">
          <SignaturePad label="Reported By Signature" value={model.reportedBySignatureData} onChange={data => upd({ reportedBySignatureData: data, reportedBySignatureDate: data ? new Date().toISOString().slice(0, 10) : model.reportedBySignatureDate })} />
          <Field label="Reported By Signature Date" type="date" value={model.reportedBySignatureDate} onChange={v => upd({ reportedBySignatureDate: v })} />
        </div>
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Supervisor Review</span>
        <div className="formPairRow">
          <SignaturePad label="Supervisor Signature" value={model.supervisorSignatureData} onChange={data => upd({ supervisorSignatureData: data, supervisorSignatureDate: data ? new Date().toISOString().slice(0, 10) : model.supervisorSignatureDate })} />
          <Field label="Supervisor Signature Date" type="date" value={model.supervisorSignatureDate} onChange={v => upd({ supervisorSignatureDate: v })} />
        </div>
      </div>

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Finish & Export" />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function UncontrolledEventWorkflow({
  model, upd, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew,
}) {
  const idx = UNCONTROLLED_EVENT_STEPS.findIndex(s => s.id === step);
  function prev() { if (idx > 0) setStep(UNCONTROLLED_EVENT_STEPS[idx - 1].id); }
  function next() { if (idx < UNCONTROLLED_EVENT_STEPS.length - 1) setStep(UNCONTROLLED_EVENT_STEPS[idx + 1].id); }

  const checks = getUncontrolledEventReadinessChecks(model);
  const checklistComplete = isUncontrolledEventReady(model);
  const locked = isUncontrolledEventPrintFinal(model);

  // Signatures/Export aren't reachable until the content steps are actually
  // filled in -- same guard JSA/Disciplinary/Separation/Medical Event use.
  const contentReady = ['event', 'narrative'].every(s => uncontrolledEventStepStatus(model, s) === 'complete');
  const lockedIds = contentReady ? [] : ['signatures', 'export'];
  function guardedJump(id) {
    if ((id === 'signatures' || id === 'export') && !contentReady) {
      const blocker = ['event', 'narrative'].find(s => uncontrolledEventStepStatus(model, s) !== 'complete');
      setStep(blocker || 'event');
      return;
    }
    setStep(id);
  }

  const isReviewStep = step === 'review';
  const shellRef = useRef(null);
  const shellWidth = useElementWidth(shellRef);
  const isTouchPrimary = useIsTouchPrimary();
  const showSideBySide = !isTouchPrimary && shellWidth >= 1000 && isReviewStep;
  const previewPanel = (
    <div className="card previewPanel">
      <div className="previewPanelHeader">
        <div>
          <strong>What Will Print</strong>
          <span>A facsimile of the printed report — not the exact page layout</span>
        </div>
      </div>
      <DocFacsimile formTitle="Uncontrolled Event Report" draft={!locked} blocks={uncontrolledEventFacsimileBlocks(model)} />
    </div>
  );

  return (
    <>
      <BuilderHeader
        kicker="Uncontrolled Event Report"
        title={model.workplaceLocation || 'Untitled Uncontrolled Event'}
        statusBadgeLabel={locked ? 'Completed' : 'Draft'}
        statusBadgeClass={model.status === 'draft' ? 'draft' : 'avail'}
        saveStatus={saveStatus}
        saveStatusState={saveStatusState}
        onSaveNow={onSaveNow}
        onBack={goDocs}
        backLabel="Documents"
      />

      <LockedContext.Provider value={locked}>
        <StepNav steps={UNCONTROLLED_EVENT_STEPS} activeStepId={step} checks={checks} onJump={guardedJump} lockedIds={lockedIds} />
        <div className={`workflowShell${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
          <div className="workflowLeft">
            {step === 'event' && <StepEvent model={model} upd={upd} next={next} />}
            {step === 'narrative' && <StepNarrative model={model} upd={upd} prev={prev} next={next} />}
            {step === 'review' && <StepReview checks={checks} prev={prev} next={next} onJumpCheck={chk => setStep(chk.step)} />}
            {step === 'signatures' && <StepSignatures model={model} upd={upd} prev={prev} next={next} />}
            {step === 'export' && (
              <ReviewExportPanel
                title="Finish & Export"
                checks={checks}
                checklistComplete={checklistComplete}
                status={model.status}
                draftExplainText="Complete the checklist below, then mark this document complete."
                markReadyHintText="Everything required is filled in. Marking it complete locks the document from editing — you can unmark it any time from here."
                onMarkReady={onMarkReady}
                onMarkIncomplete={onMarkIncomplete}
                pdfExportState={pdfExportState}
                isPdfStale={isPdfStale}
                onGeneratePdf={onGeneratePdf}
                onDownload={onDownload}
                onStartNew={onStartNew}
                startNewLabel="Start a new uncontrolled event report"
                onExportDraft={() => downloadDraftFile('uncontrolledEvent', model, buildDraftFilename(model.workplaceLocation, 'Uncontrolled Event', model.eventDate))}
                onBack={prev}
                onJumpCheck={chk => setStep(chk.step)}
              />
            )}
            {!showSideBySide && isReviewStep && previewPanel}
          </div>
          {showSideBySide && (
            <div className="workflowRight">
              {previewPanel}
            </div>
          )}
        </div>
      </LockedContext.Provider>
    </>
  );
}
