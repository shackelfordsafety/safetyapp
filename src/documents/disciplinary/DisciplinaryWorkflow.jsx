import { lazy, Suspense, useRef } from 'react';
import {
  DISCIPLINARY_STEPS, WARNING_LEVELS,
  getDisciplinaryReadinessChecks, isDisciplinaryReady, isDisciplinaryPrintFinal, isVerbalWarning,
  disciplinaryStepStatus,
} from './disciplinaryModel';
import { disciplinaryFacsimileBlocks } from './disciplinaryPdfDraw';
import {
  Field, TextAreaField, SegmentedToggle, StepPanel, NumberedSection, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth, EmployeeOwned,
} from '../FormPrimitives';
import { LockedContext } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';

/* Lazy like everything that talks to the cloud: a manager filling this in
   with no signal never downloads the handoff machinery. */
const EmployeeHandoffPanel = lazy(() => import('../../employee/EmployeeHandoffPanel'));

/* ── Step: Notice Details — employee info, warning level, sections 1-4 ──
   Section 4 (Employee Statement) is here again as of 2026-09-15. It was
   removed on 2026-08-29 so the employee would write it by hand on the
   printed copy; every other half of that rule has since been reversed and
   there is no printed copy in the flow any more.

   Left blank it still prints as a ruled box, so writing it by hand is
   never taken away -- it just stops being the only option. */
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

      {/* Section 4. Typable again as of 2026-09-15 -- see the comment on
          employeeStatement in disciplinaryModel.js for why it stopped
          being, and why that reason no longer holds.

          Skipped entirely for a verbal warning, which is a coaching
          conversation with no formal statement to take down -- the same
          rule sectionsForModel applies when printing. */}
      {!isVerbalWarning(model) && (
        <NumberedSection number={4} title="Employee Statement" help="The employee's own words. Type what they say, or leave it blank and the notice prints a ruled box for them to write in by hand.">
          {/* If he wrote it himself on his own phone, it stops being
              something anybody here can retype. See EmployeeOwned. */}
          <EmployeeOwned when={model.employeeResponseAt}>
            <TextAreaField
              label="Does the employee want to say anything about this?"
              rows={4}
              value={model.employeeStatement}
              onChange={v => upd({ employeeStatement: v })}
              voice
            />
          </EmployeeOwned>
          {model.employeeResponseAt && (
            <p className="helperText">
              {model.employeeName || 'The employee'} wrote this on his own phone
              on {fmtWhen(model.employeeResponseAt)}. It is his statement, so it
              cannot be edited here &mdash; and a copy of exactly what he typed is
              kept separately. If it needs to be redone, send him a new code.
            </p>
          )}
        </NumberedSection>
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

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Signatures" />
    </StepPanel>
  );
}

/* ── Step: Review — read the whole notice over before anyone signs it.
   No Mark Complete here -- that only makes sense after Signatures (see
   StepExport below, which is where it actually lives). */
function StepReview({ checks, prev, next, onJumpCheck }) {
  const remainingCount = checks.filter(c => !c.ok).length;
  return (
    <StepPanel title="Review" intro="Read the finished notice over before it goes. Tap any item below to fix it.">
      <div className="card">
        <div className="cardHeader"><strong>Readiness</strong></div>
        <p className="helperText">
          {remainingCount === 0
            ? 'Everything is filled in and signed. Send it when you are ready.'
            : `${remainingCount} ${remainingCount === 1 ? 'item' : 'items'} still needed — tap one to go straight to it.`}
        </p>
        <ReadinessChecklist checks={checks} onJump={onJumpCheck} />
      </div>
      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Submit" />
    </StepPanel>
  );
}

/* ── Step: Signatures — the three people in the room: the manager giving
   the notice, the employee, and a witness.

   This used to say "manager only -- employee always signs the printed copy
   by hand", from the 2026-08-29 rule that only staff signatures were
   digitized. That was reversed on 2026-09-11 when the witness slot was
   added and employee signatures became digital; the comment was left
   behind, describing a form that no longer existed, while the step
   underneath it captured all three. ── */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/* When the employee sent his part back, said the way a person says it.
   Date and time both, because "he signed it at 2:14" is the kind of detail
   that settles an argument months later. */
function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'his own device';
  return d.toLocaleString(undefined, {
    month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/* What the witness is actually attesting to. Same reasoning as separation:
   a name under the word "Witness" proves nothing on its own -- it has to
   say what was witnessed, or it is worth nothing the day somebody disputes
   the write-up. */
function witnessStatementFor(model) {
  const who = model.employeeName ? model.employeeName : 'the employee';
  const outcome = model.employeeRefusedToSign
    ? `${who} was given this notice and did not sign — refused or not available.`
    : `${who} was given this notice and signed to acknowledge receipt.`;
  return `I was present when this was discussed. ${outcome}`;
}

function StepSignatures({ model, upd, prev, next }) {
  const verbal = isVerbalWarning(model);
  return (
    <StepPanel title="Signatures" intro="Everyone signs here — manager, employee, and a witness who was in the room. Nothing has to be printed to be signed.">
      {verbal && (
        <p className="helperText">A verbal warning is a coaching conversation, not a signed notice — the employee doesn&apos;t sign this at all. Document what was said in Notice Details; only the manager signs below.</p>
      )}
      <div className="formPairRow">
        <SignaturePad label="Manager Signature" value={model.managerSignatureData} onChange={data => upd({ managerSignatureData: data, managerSignatureDate: data ? today() : model.managerSignatureDate })} />
        <Field label="Manager Signature Date" type="date" value={model.managerSignatureDate} onChange={v => upd({ managerSignatureDate: v })} />
      </div>
      {/* Deliberately NOT the Supervisor field from Notice Details. That one
          says who the employee works for; this says who is giving the notice
          and signing above. They are often different people, and on the
          separation form printing the first over the second put the wrong
          man's name on a real record. */}
      <Field
        label="Manager Name and Title"
        value={model.managerName}
        onChange={v => upd({ managerName: v })}
        placeholder="Whoever is signing above"
      />
      <p className="helperText">
        Whoever is giving this notice &mdash; not the employee&rsquo;s supervisor, unless they
        happen to be the same person. This is the name that prints under the signature.
      </p>

      {/* A verbal warning is not signed by anybody but the manager, so none
          of the rest of this belongs on screen for one. */}
      {!verbal && (
        <>
          {/* His part, on his phone. Sits above the pads deliberately: this
              is the way it should normally go, and the pads below are the
              fallback for a dead phone or no signal -- not the other way
              round. Everything below still works if he never scans it. */}
          <Suspense fallback={null}>
            <EmployeeHandoffPanel
              docType="disciplinary"
              model={model}
              employeeName={model.employeeName}
              needs={['statement', 'signature']}
              respondedAt={model.employeeResponseAt}
              onReceived={answer => upd({
                /* His words go in section 4 only if he gave any -- an empty
                   statement must not wipe one typed for him earlier. */
                ...(answer.statement ? { employeeStatement: answer.statement } : {}),
                ...(answer.signatureData
                  ? {
                    employeeSignatureData: answer.signatureData,
                    employeeSignatureDate: today(),
                    employeeRefusedToSign: false,
                  }
                  : {}),
                /* The stamp that makes all of the above his, and read-only
                   from here on. Set even if he sent nothing back but a
                   signature -- he still did his part on his own device. */
                employeeResponseAt: answer.respondedAt || new Date().toISOString(),
              })}
            />
          </Suspense>

          {/* Everything the employee himself did, sealed once it came off
              his phone. The toggle is in here too: flipping it to "refused"
              afterwards would print "Refused / Unavailable to Sign" over a
              man who demonstrably did sign. */}
          <EmployeeOwned when={model.employeeResponseAt}>
            <SegmentedToggle
              label="Is the employee signing this?"
              value={model.employeeRefusedToSign ? 'no' : 'yes'}
              onChange={v => upd({ employeeRefusedToSign: v === 'no' })}
              options={[
                { value: 'yes', label: 'Yes', tone: 'yes' },
                { value: 'no', label: 'No — refused or not available', tone: 'no' },
              ]}
            />

            {!model.employeeRefusedToSign && (
              <div className="formPairRow">
                <SignaturePad
                  label={model.employeeName ? `${model.employeeName} — Employee Signature` : 'Employee Signature'}
                  value={model.employeeSignatureData}
                  onChange={data => upd({ employeeSignatureData: data, employeeSignatureDate: data ? today() : model.employeeSignatureDate })}
                />
                <Field label="Employee Signature Date" type="date" value={model.employeeSignatureDate} onChange={v => upd({ employeeSignatureDate: v })} />
              </div>
            )}
          </EmployeeOwned>
          {model.employeeResponseAt && (
            <p className="helperText">
              Signed by {model.employeeName || 'the employee'} on his own phone on{' '}
              {fmtWhen(model.employeeResponseAt)}. His signature is his &mdash; nobody
              here can replace or remove it. Send him a new code if it has to be done
              again.
            </p>
          )}
          <p className="helperText">
            Signing acknowledges <strong>receipt</strong> of this notice. It does not mean the
            employee agrees with it, and the printed notice says so.
          </p>

          {/* The witness. An employee refusing to sign a write-up is the
              normal case, and a blank line proves nothing about whether he
              was ever told. */}
          <div className="formPairRow">
            <SignaturePad
              label="Witness Signature"
              value={model.witnessSignatureData}
              onChange={data => upd({
                witnessSignatureData: data,
                witnessSignatureDate: data ? today() : model.witnessSignatureDate,
                witnessStatement: data ? witnessStatementFor(model) : '',
              })}
            />
            <Field label="Witness Name and Title" value={model.witnessName} onChange={v => upd({ witnessName: v })} />
          </div>
          <p className="helperText">{witnessStatementFor(model)}</p>
        </>
      )}

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Review" />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function DisciplinaryWorkflow({
  model, upd, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew, onHandedOff,
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
          <span>A preview of the printed notice — not the exact page layout</span>
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
                title="Submit"
                checks={checks}
                checklistComplete={checklistComplete}
                status={model.status}
                draftExplainText="Complete the checklist below, then mark this document complete."
                markReadyHintText="Everything required is filled in. Send it for review below."
                onMarkReady={onMarkReady}
                onMarkIncomplete={onMarkIncomplete}
                pdfExportState={pdfExportState}
                isPdfStale={isPdfStale}
                onGeneratePdf={onGeneratePdf}
                onDownload={onDownload}
                archiveFiling={{ docType: 'disciplinary', model }}
                onHandedOff={onHandedOff}
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
