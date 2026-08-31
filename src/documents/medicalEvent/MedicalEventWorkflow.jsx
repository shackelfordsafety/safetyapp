import { useRef } from 'react';
import {
  MEDICAL_EVENT_STEPS,
  SYMPTOM_ONSET_OPTIONS, RESPONSE_ACTIONS, MEDICAL_EVALUATION_TYPES, WORK_STATUS_OPTIONS, INITIAL_CLASSIFICATIONS,
  MEDICAL_ATTACHMENT_OPTIONS,
  getMedicalEventReadinessChecks, isMedicalEventReady, isMedicalEventPrintFinal,
  medicalEventStepStatus,
} from './medicalEventModel';
import { medicalEventFacsimileBlocks } from './medicalEventPdfDraw';
import {
  Field, TextAreaField, SegmentedToggle, ChipGroup, StepPanel, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth,
} from '../FormPrimitives';
import { LockedContext } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';

function toggleInList(list, item) {
  return (list || []).includes(item) ? list.filter(x => x !== item) : [...(list || []), item];
}

/* ── Step: Event & Response ── */
function StepCondition({ model, upd, next }) {
  return (
    <StepPanel title="Event & Response" intro="What the employee reported, and what was done right away. Keep this factual — record what was said and observed, not a diagnosis or cause.">
      <div className="formSection">
        <span className="formSectionHeading">Employee Information</span>
        <div className="formGrid">
          <Field label="Employee Name" value={model.employeeName} onChange={v => upd({ employeeName: v })} />
          <div className="formPairRow">
            <Field label="Supervisor" value={model.supervisor} onChange={v => upd({ supervisor: v })} />
            <Field label="Position" value={model.position} onChange={v => upd({ position: v })} />
          </div>
          <Field label="Project / Location" value={model.projectLocation} onChange={v => upd({ projectLocation: v })} />
          <div className="formPairRow">
            <Field label="Date" type="date" value={model.eventDate} onChange={v => upd({ eventDate: v })} />
            <Field label="Time Reported" type="time" value={model.timeReported} onChange={v => upd({ timeReported: v })} />
          </div>
        </div>
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Employee-Reported Condition</span>
        <TextAreaField label="What symptoms or concerns did the employee report?" rows={4} value={model.reportedSymptoms} onChange={v => upd({ reportedSymptoms: v })} voice />
        <SegmentedToggle label="When Symptoms First Appeared" value={model.symptomsOnset} onChange={v => upd({ symptomsOnset: v })} options={SYMPTOM_ONSET_OPTIONS} />
        <SegmentedToggle
          label="Specific Work Event or Exposure Reported?"
          value={model.specificWorkEventReported}
          onChange={v => upd({ specificWorkEventReported: v })}
          options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }]}
        />
        {model.specificWorkEventReported === 'yes' && (
          <>
            <TextAreaField label="Describe the work event / exposure reported" rows={3} value={model.workEventDescription} onChange={v => upd({ workEventDescription: v })} voice />
            <div className="pdfStaleWarning">
              <strong>A specific work event/exposure was reported.</strong>
              <p>Complete the Incident Reporting and Investigation Form when a specific work event or exposure is reported. This Medical Event form does not replace it, and this app will not create that report automatically or assume it is required — confirm with Safety/Supervision.</p>
            </div>
          </>
        )}
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Response / Actions Taken</span>
        <ChipGroup label="Actions taken (check all that apply)" options={RESPONSE_ACTIONS} selected={model.responseActions} onToggle={opt => upd({ responseActions: toggleInList(model.responseActions, opt) })} />
        {(model.responseActions || []).includes('Other') && (
          <Field label="Other action — specify" value={model.responseActionsOther} onChange={v => upd({ responseActionsOther: v })} />
        )}
        <TextAreaField label="What did safety/supervision observe and do?" help="Separate from what the employee reported above." rows={4} value={model.safetyObservations} onChange={v => upd({ safetyObservations: v })} voice />
      </div>

      <StepFooter hasNext onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Evaluation & Classification ── */
function StepEvaluation({ model, upd, prev, next }) {
  return (
    <StepPanel title="Evaluation & Classification" intro="Medical evaluation, current work status, and the initial classification. This app never decides work-relatedness or OSHA recordability — select what applies based on the facts.">
      <div className="formSection">
        <span className="formSectionHeading">Medical Evaluation / Work Status</span>
        <SegmentedToggle label="Medical Evaluation" value={model.medicalEvaluationType} onChange={v => upd({ medicalEvaluationType: v })} options={MEDICAL_EVALUATION_TYPES} />
        {model.medicalEvaluationType === 'other' && (
          <Field label="Other evaluation — specify" value={model.medicalEvaluationOther} onChange={v => upd({ medicalEvaluationOther: v })} />
        )}
        <Field label="Clinic / Provider" value={model.clinicProvider} onChange={v => upd({ clinicProvider: v })} />
        <SegmentedToggle label="Work Status" value={model.workStatus} onChange={v => upd({ workStatus: v })} options={WORK_STATUS_OPTIONS} />
        {model.workStatus === 'fullDuty' && (
          <Field label="Full Duty On" type="date" value={model.fullDutyOnDate} onChange={v => upd({ fullDutyOnDate: v })} />
        )}
        {model.workStatus === 'offWork' && (
          <Field label="Off Work Until" type="date" value={model.offWorkUntilDate} onChange={v => upd({ offWorkUntilDate: v })} />
        )}
        <SegmentedToggle
          label="Provider Note Attached"
          value={model.providerNoteAttached ? 'yes' : 'no'}
          onChange={v => upd({ providerNoteAttached: v === 'yes' })}
          options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }]}
        />
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Attachments</span>
        <ChipGroup label="Attached to this report (check all that apply)" options={MEDICAL_ATTACHMENT_OPTIONS} selected={model.attachments} onToggle={opt => upd({ attachments: toggleInList(model.attachments, opt) })} />
        {(model.attachments || []).includes('Other') && (
          <Field label="Other attachment — specify" value={model.attachmentOther} onChange={v => upd({ attachmentOther: v })} />
        )}
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Initial Classification</span>
        <p className="helperText">Selected based on the facts above — this app does not determine or suggest a classification.</p>
        <SegmentedToggle label="Initial Classification" value={model.initialClassification} onChange={v => upd({ initialClassification: v })} options={INITIAL_CLASSIFICATIONS} />
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

/* ── Step: Signature — Safety/Supervisor only. The employee doesn't sign
   digitally in this app at all (Fonzo, 2026-08-29: "the only thing i wanted
   digitized is the superintendent, foreman, safety parts") -- an employee
   name field stays available since it's just metadata, printed above a
   blank line, not something authored by the employee. ── */
function StepSignatures({ model, upd, prev, next }) {
  return (
    <StepPanel title="Signature" intro="Safety/Supervisor signs here. Leave a name blank to print the employee/supervisor named on Event & Response.">
      <Field label="Employee Name (printed)" value={model.employeeSignatureName} placeholder={model.employeeName} onChange={v => upd({ employeeSignatureName: v })} />

      <div className="formPairRow">
        <SignaturePad label="Safety / Supervisor Signature" value={model.supervisorSignatureData} onChange={data => upd({ supervisorSignatureData: data, supervisorSignatureDate: data ? new Date().toISOString().slice(0, 10) : model.supervisorSignatureDate })} />
        <Field label="Supervisor Signature Date" type="date" value={model.supervisorSignatureDate} onChange={v => upd({ supervisorSignatureDate: v })} />
      </div>
      <Field label="Safety / Supervisor Name (printed)" value={model.supervisorSignatureName} placeholder={model.supervisor} onChange={v => upd({ supervisorSignatureName: v })} />

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Finish & Export" />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function MedicalEventWorkflow({
  model, upd, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew,
}) {
  const idx = MEDICAL_EVENT_STEPS.findIndex(s => s.id === step);
  function prev() { if (idx > 0) setStep(MEDICAL_EVENT_STEPS[idx - 1].id); }
  function next() { if (idx < MEDICAL_EVENT_STEPS.length - 1) setStep(MEDICAL_EVENT_STEPS[idx + 1].id); }

  const checks = getMedicalEventReadinessChecks(model);
  const checklistComplete = isMedicalEventReady(model);
  const locked = isMedicalEventPrintFinal(model);

  // Signatures/Export aren't reachable until the content steps are actually
  // filled in -- same guard JSA/Disciplinary/Separation use.
  const contentReady = ['condition', 'evaluation'].every(s => medicalEventStepStatus(model, s) === 'complete');
  const lockedIds = contentReady ? [] : ['signatures', 'export'];
  function guardedJump(id) {
    if ((id === 'signatures' || id === 'export') && !contentReady) {
      const blocker = ['condition', 'evaluation'].find(s => medicalEventStepStatus(model, s) !== 'complete');
      setStep(blocker || 'condition');
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
          <span>A facsimile of the printed form — not the exact page layout</span>
        </div>
      </div>
      <DocFacsimile formTitle="Employee Medical Event Form" draft={!locked} blocks={medicalEventFacsimileBlocks(model)} />
    </div>
  );

  return (
    <>
      <BuilderHeader
        kicker="Employee Medical Event"
        title={model.employeeName || 'Untitled Medical Event'}
        statusBadgeLabel={locked ? 'Completed' : 'Draft'}
        statusBadgeClass={model.status === 'draft' ? 'draft' : 'avail'}
        saveStatus={saveStatus}
        saveStatusState={saveStatusState}
        onSaveNow={onSaveNow}
        onBack={goDocs}
        backLabel="Documents"
      />

      <LockedContext.Provider value={locked}>
        <StepNav steps={MEDICAL_EVENT_STEPS} activeStepId={step} checks={checks} onJump={guardedJump} lockedIds={lockedIds} />
        <div className={`workflowShell${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
          <div className="workflowLeft">
            {step === 'condition' && <StepCondition model={model} upd={upd} next={next} />}
            {step === 'evaluation' && <StepEvaluation model={model} upd={upd} prev={prev} next={next} />}
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
                startNewLabel="Start a new medical event report"
                onExportDraft={() => downloadDraftFile('medicalEvent', model, buildDraftFilename(model.employeeName, 'Medical Event', model.eventDate))}
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
