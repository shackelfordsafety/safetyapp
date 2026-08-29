import { useRef } from 'react';
import {
  DISCIPLINARY_STEPS, WARNING_LEVELS,
  getDisciplinaryReadinessChecks, isDisciplinaryReady, isDisciplinaryPrintFinal, isVerbalWarning,
  disciplinaryStepStatus,
} from './disciplinaryModel';
import { disciplinaryFacsimileBlocks } from './disciplinaryPdfDraw';
import {
  Field, TextAreaField, SegmentedToggle, StepPanel, NumberedSection, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth,
} from '../FormPrimitives';
import { LockedContext } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';

/* ── Step: Notice Details — employee info, warning level, sections 1-3 ──
   Section 4 (Employee Statement) is deliberately not here -- it's the
   employee's own words, in their own hand, on the printed copy (Fonzo,
   2026-08-29). The PDF still prints "4. EMPLOYEE STATEMENT" with a blank
   ruled box for exactly that -- see sectionsForModel/employeeStatement in
   disciplinaryPdfDraw.js/disciplinaryModel.js. */
function StepNotice({ model, upd, next }) {
  return (
    <StepPanel title="Notice Details" intro="Basic facts about the employee and what occurred. Enter only what happened — do not decide the outcome here.">
      <div className="formGrid">
        <Field label="Employee Name" value={model.employeeName} onChange={v => upd({ employeeName: v })} />
        <div className="formPairRow">
          <Field label="Supervisor" value={model.supervisor} onChange={v => upd({ supervisor: v })} />
          <Field label="Position" value={model.position} onChange={v => upd({ position: v })} />
        </div>
        <Field label="Date" type="date" value={model.noticeDate} onChange={v => upd({ noticeDate: v })} />
      </div>

      <SegmentedToggle
        label="Warning Level"
        value={model.warningLevel}
        onChange={v => upd({ warningLevel: v })}
        options={WARNING_LEVELS}
      />

      <NumberedSection number={1} title="What Occurred">
        <TextAreaField label="What happened?" rows={5} value={model.whatOccurred} onChange={v => upd({ whatOccurred: v })} voice />
      </NumberedSection>

      <NumberedSection number={2} title="Earlier Warnings / Discussions" help="Any earlier verbal or written warnings, or discussions, on this same issue. Leave blank if this is the first occurrence.">
        <TextAreaField label="Has this employee been warned or talked to about this before?" rows={3} value={model.earlierWarnings} onChange={v => upd({ earlierWarnings: v })} voice />
      </NumberedSection>

      <NumberedSection number={3} title="Company Policy States">
        <TextAreaField label="What company rule or policy applies?" rows={3} value={model.companyPolicyStates} onChange={v => upd({ companyPolicyStates: v })} voice />
      </NumberedSection>

      {!isVerbalWarning(model) && (
        <p className="helperText">Section 4 (Employee Statement) prints as blank ruled space below Section 3 — the employee writes it by hand on the printed copy.</p>
      )}

      <StepFooter hasNext onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Corrective Action — sections 5-7 (content only, no signatures —
   signing happens in its own step, after Review) ── */
function StepResponse({ model, upd, prev, next }) {
  return (
    <StepPanel title="Corrective Action" intro="What the employee must do, what the company will do, and the consequence if this is not corrected.">
      <NumberedSection number={5} title="Corrective Action Required of Employee">
        <TextAreaField label="What must the employee do to correct this?" rows={4} value={model.correctiveActionRequired} onChange={v => upd({ correctiveActionRequired: v })} voice />
      </NumberedSection>

      <NumberedSection number={6} title="The Company Will">
        <TextAreaField label="What will the company do?" rows={3} value={model.companyWill} onChange={v => upd({ companyWill: v })} voice />
      </NumberedSection>

      <NumberedSection number={7} title="If Behavior Is Not Corrected / Performance Does Not Improve">
        <TextAreaField label="What happens if this isn't corrected?" rows={3} value={model.ifNotCorrected} onChange={v => upd({ ifNotCorrected: v })} voice />
      </NumberedSection>

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Review" />
    </StepPanel>
  );
}

/* ── Step: Review — read the whole notice over before anyone signs it.
   No Mark Complete here -- that only makes sense after Signatures (see
   StepExport below, which is where it actually lives). */
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

/* ── Step: Signature — manager only. Employee always signs the printed
   copy by hand (Fonzo, 2026-08-29: "the only thing i wanted digitized is
   the superintendent, foreman, safety parts"). ── */
function StepSignatures({ model, upd, prev, next }) {
  return (
    <StepPanel title="Signature" intro="Manager signs here. The employee signs the printed copy by hand — this notice always prints a blank employee signature line.">
      {isVerbalWarning(model) && (
        <p className="helperText">A verbal warning is a coaching conversation, not a signed notice — the employee doesn't sign this at all. Document what was said in Notice Details; only the manager signs below.</p>
      )}
      <div className="formPairRow">
        <SignaturePad label="Manager Signature" value={model.managerSignatureData} onChange={data => upd({ managerSignatureData: data, managerSignatureDate: data ? new Date().toISOString().slice(0, 10) : model.managerSignatureDate })} />
        <Field label="Manager Signature Date" type="date" value={model.managerSignatureDate} onChange={v => upd({ managerSignatureDate: v })} />
      </div>
      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Finish & Export" />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function DisciplinaryWorkflow({
  model, upd, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew,
}) {
  const idx = DISCIPLINARY_STEPS.findIndex(s => s.id === step);
  function prev() { if (idx > 0) setStep(DISCIPLINARY_STEPS[idx - 1].id); }
  function next() { if (idx < DISCIPLINARY_STEPS.length - 1) setStep(DISCIPLINARY_STEPS[idx + 1].id); }

  const checks = getDisciplinaryReadinessChecks(model);
  const checklistComplete = isDisciplinaryReady(model);
  const locked = isDisciplinaryPrintFinal(model);

  // Signatures/Export aren't reachable until the content steps are actually
  // filled in -- same guard JSA uses, so a direct StepNav jump can't land on
  // a blank notice ready to sign (Separation was missing this entirely;
  // this is that same fix, applied here too).
  const contentReady = ['notice', 'response'].every(s => disciplinaryStepStatus(model, s) === 'complete');
  const lockedIds = contentReady ? [] : ['signatures', 'export'];
  function guardedJump(id) {
    if ((id === 'signatures' || id === 'export') && !contentReady) {
      const blocker = ['notice', 'response'].find(s => disciplinaryStepStatus(model, s) !== 'complete');
      setStep(blocker || 'notice');
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
          <span>A facsimile of the printed notice — not the exact page layout</span>
        </div>
      </div>
      <DocFacsimile formTitle="Employee Disciplinary Notice Form" draft={!locked} blocks={disciplinaryFacsimileBlocks(model)} />
    </div>
  );

  return (
    <>
      <BuilderHeader
        kicker="Employee Disciplinary Notice"
        title={model.employeeName || 'Untitled Disciplinary Notice'}
        statusBadgeLabel={locked ? 'Completed' : 'Draft'}
        statusBadgeClass={model.status === 'draft' ? 'draft' : 'avail'}
        saveStatus={saveStatus}
        saveStatusState={saveStatusState}
        onSaveNow={onSaveNow}
        onBack={goDocs}
        backLabel="Documents"
      />

      <LockedContext.Provider value={locked}>
        <StepNav steps={DISCIPLINARY_STEPS} activeStepId={step} checks={checks} onJump={guardedJump} lockedIds={lockedIds} />
        <div className={`workflowShell${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
          <div className="workflowLeft">
            {step === 'notice' && <StepNotice model={model} upd={upd} next={next} />}
            {step === 'response' && <StepResponse model={model} upd={upd} prev={prev} next={next} />}
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
                startNewLabel="Start a new disciplinary notice"
                onExportDraft={() => downloadDraftFile('disciplinary', model, buildDraftFilename(model.employeeName, 'Disciplinary Notice', model.noticeDate))}
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
