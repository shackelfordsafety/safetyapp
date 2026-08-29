import { useRef } from 'react';
import {
  SEPARATION_STEPS, SEPARATION_TYPES, SEPARATION_REASON_GROUPS,
  REHIRE_STATUSES, PROPERTY_RETURNED_OPTIONS, ACCESS_REMOVED_OPTIONS,
  getSeparationReadinessChecks, isSeparationReady, isSeparationPrintFinal,
  separationStepStatus,
} from './separationModel';
import { separationFacsimileBlocks } from './separationPdfDraw';
import {
  Field, TextAreaField, SegmentedToggle, ChipGroup, StepPanel, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth,
} from '../FormPrimitives';
import { LockedContext, useLocked } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';

function toggleInList(list, item) {
  return (list || []).includes(item) ? list.filter(x => x !== item) : [...(list || []), item];
}

/* Simple single boolean toggle button -- same pattern as Medical Event's
   "Provider Note Attached" -- for the two plain checkbox-style closeout
   items the source form has no other options for (Final timesheet
   submitted / Expenses resolved). */
function BooleanToggle({ label, value, onChange, onLabel = 'Yes', offLabel = 'No' }) {
  const locked = useLocked();
  return (
    <label className="field">
      <span>{label}</span>
      <div className="yesNoToggle">
        <button
          type="button"
          aria-pressed={value}
          aria-disabled={locked}
          className={`btn${value ? ' active yes' : ''}`}
          onClick={() => { if (!locked) onChange(!value); }}
        >
          {value ? onLabel : offLabel}
        </button>
      </div>
    </label>
  );
}

/* ── Step: Separation Details — employee info, type, reason, explanation ── */
function StepDetails({ model, upd, next }) {
  return (
    <StepPanel title="Separation Details" intro="Employee information, the type and reason for separation, and a brief explanation.">
      <div className="formSection">
        <span className="formSectionHeading">Employee Information</span>
        <div className="formGrid">
          <div className="formPairRow">
            <Field label="Employee Name" value={model.employeeName} onChange={v => upd({ employeeName: v })} />
            <Field label="Employee ID" value={model.employeeId} onChange={v => upd({ employeeId: v })} />
          </div>
          <div className="formPairRow">
            <Field label="Position" value={model.position} onChange={v => upd({ position: v })} />
            <Field label="Project / Location" value={model.projectLocation} onChange={v => upd({ projectLocation: v })} />
          </div>
          <div className="formPairRow">
            <Field label="Supervisor" value={model.supervisor} onChange={v => upd({ supervisor: v })} />
            <Field label="Last Day Worked" type="date" value={model.lastDayWorked} onChange={v => upd({ lastDayWorked: v })} />
          </div>
          <div className="formPairRow">
            <Field label="Effective Separation Date" type="date" value={model.effectiveSeparationDate} onChange={v => upd({ effectiveSeparationDate: v })} />
            <Field label="Date Submitted" type="date" value={model.dateSubmitted} onChange={v => upd({ dateSubmitted: v })} />
          </div>
        </div>
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Separation Details</span>
        <SegmentedToggle
          label="Separation Type"
          value={model.separationType}
          onChange={v => upd({ separationType: v })}
          options={SEPARATION_TYPES}
        />
        {SEPARATION_REASON_GROUPS.map((group, i) => (
          <SegmentedToggle
            key={i}
            label={i === 0 ? 'Reason' : undefined}
            value={model.separationReason}
            onChange={v => upd({ separationReason: v })}
            options={group.map(r => ({ value: r, label: r }))}
          />
        ))}
        <SegmentedToggle
          value={model.separationReason}
          onChange={v => upd({ separationReason: v })}
          options={[{ value: 'Other', label: 'Other' }]}
        />
        {model.separationReason === 'Other' && (
          <Field label="Other reason — specify" value={model.separationReasonOther} onChange={v => upd({ separationReasonOther: v })} />
        )}
        <TextAreaField label="Explain what happened and anything management should know." rows={5} value={model.detailedExplanation} onChange={v => upd({ detailedExplanation: v })} voice />
      </div>

      <StepFooter hasNext onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Closeout — discipline/rehire, company closeout (content only —
   signing happens in its own step, after Review) ── */
function StepCloseout({ model, upd, prev, next }) {
  const isInvoluntary = model.separationType === 'involuntary';
  return (
    <StepPanel title="Closeout" intro="Discipline and rehire status, and company closeout.">
      <div className="formSection">
        <span className="formSectionHeading">Discipline / Rehire Status</span>
        {isInvoluntary && (
          <>
            <SegmentedToggle
              label="If involuntary, were warning notices given?"
              value={model.warningNoticesGiven}
              onChange={v => upd({ warningNoticesGiven: v })}
              options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }, { value: 'na', label: 'N/A' }]}
            />
            {model.warningNoticesGiven === 'yes' && (
              <Field label="How many warning notices?" value={model.warningNoticesCount} onChange={v => upd({ warningNoticesCount: v })} />
            )}
          </>
        )}
        <SegmentedToggle
          label="Documentation attached?"
          value={model.documentationAttached}
          onChange={v => upd({ documentationAttached: v })}
          options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }]}
        />
        <SegmentedToggle
          label="Eligible for rehire?"
          value={model.eligibleForRehire}
          onChange={v => upd({ eligibleForRehire: v })}
          options={REHIRE_STATUSES}
        />
        {model.eligibleForRehire === 'no' && (
          <Field label="Reason not eligible for rehire" value={model.rehireReasonIfNo} onChange={v => upd({ rehireReasonIfNo: v })} />
        )}
      </div>

      <div className="formSection">
        <span className="formSectionHeading">Company Closeout</span>
        <ChipGroup label="Property returned (check all that apply)" options={PROPERTY_RETURNED_OPTIONS} selected={model.propertyReturned} onToggle={opt => upd({ propertyReturned: toggleInList(model.propertyReturned, opt) })} />
        {(model.propertyReturned || []).includes('Other') && (
          <Field label="Other property — specify" value={model.propertyReturnedOther} onChange={v => upd({ propertyReturnedOther: v })} />
        )}
        <ChipGroup label="Access removed (check all that apply)" options={ACCESS_REMOVED_OPTIONS} selected={model.accessRemoved} onToggle={opt => upd({ accessRemoved: toggleInList(model.accessRemoved, opt) })} />
        {(model.accessRemoved || []).includes('Other') && (
          <Field label="Other access — specify" value={model.accessRemovedOther} onChange={v => upd({ accessRemovedOther: v })} />
        )}
        <BooleanToggle label="Final timesheet submitted" value={model.finalTimesheetSubmitted} onChange={v => upd({ finalTimesheetSubmitted: v })} />
        <BooleanToggle label="Expenses / receipts resolved" value={model.expensesResolved} onChange={v => upd({ expensesResolved: v })} />
        <TextAreaField label="Any company property or paperwork still outstanding?" rows={3} value={model.outstandingPropertyNotes} onChange={v => upd({ outstandingPropertyNotes: v })} voice />
      </div>

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Review" />
    </StepPanel>
  );
}

/* ── Step: Review — read the whole record over before anyone signs it.
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

/* ── Step: Signature — supervisor only. Employee and HR always sign the
   printed copy by hand (Fonzo, 2026-08-29: "the only thing i wanted
   digitized is the superintendent, foreman, safety parts"). ── */
function StepSignatures({ model, upd, prev, next }) {
  return (
    <StepPanel title="Signature" intro="Supervisor signs here. Employee and HR sign the printed copy by hand — this record always prints blank lines for both.">
      <div className="formPairRow">
        <SignaturePad label="Supervisor Signature" value={model.supervisorSignatureData} onChange={data => upd({ supervisorSignatureData: data, supervisorSignatureDate: data ? new Date().toISOString().slice(0, 10) : model.supervisorSignatureDate })} />
        <Field label="Supervisor Signature Date" type="date" value={model.supervisorSignatureDate} onChange={v => upd({ supervisorSignatureDate: v })} />
      </div>
      <Field label="HR / Management Name" value={model.hrName} onChange={v => upd({ hrName: v })} />
      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Finish & Export" />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function SeparationWorkflow({
  model, upd, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew,
}) {
  const idx = SEPARATION_STEPS.findIndex(s => s.id === step);
  function prev() { if (idx > 0) setStep(SEPARATION_STEPS[idx - 1].id); }
  function next() { if (idx < SEPARATION_STEPS.length - 1) setStep(SEPARATION_STEPS[idx + 1].id); }

  const checks = getSeparationReadinessChecks(model);
  const checklistComplete = isSeparationReady(model);
  const locked = isSeparationPrintFinal(model);

  // Signatures/Export aren't reachable until the content steps are actually
  // filled in -- Separation had no lock at all before this, so a direct
  // StepNav jump could land straight on a blank Signatures step.
  const contentReady = ['details', 'closeout'].every(s => separationStepStatus(model, s) === 'complete');
  const lockedIds = contentReady ? [] : ['signatures', 'export'];
  function guardedJump(id) {
    if ((id === 'signatures' || id === 'export') && !contentReady) {
      const blocker = ['details', 'closeout'].find(s => separationStepStatus(model, s) !== 'complete');
      setStep(blocker || 'details');
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
      <DocFacsimile formTitle="Employee Separation Form" draft={!locked} blocks={separationFacsimileBlocks(model)} />
    </div>
  );

  return (
    <>
      <BuilderHeader
        kicker="Employee Separation"
        title={model.employeeName || 'Untitled Separation'}
        statusBadgeLabel={locked ? 'Completed' : 'Draft'}
        statusBadgeClass={model.status === 'draft' ? 'draft' : 'avail'}
        saveStatus={saveStatus}
        saveStatusState={saveStatusState}
        onSaveNow={onSaveNow}
        onBack={goDocs}
        backLabel="Documents"
      />

      <LockedContext.Provider value={locked}>
        <div className={`workflowShell withStepNav${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
          <StepNav steps={SEPARATION_STEPS} activeStepId={step} checks={checks} onJump={guardedJump} lockedIds={lockedIds} />
          <div className="workflowLeft">
            {step === 'details' && <StepDetails model={model} upd={upd} next={next} />}
            {step === 'closeout' && <StepCloseout model={model} upd={upd} prev={prev} next={next} />}
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
                startNewLabel="Start a new separation record"
                onExportDraft={() => downloadDraftFile('separation', model, buildDraftFilename(model.employeeName, 'Separation', model.effectiveSeparationDate))}
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
