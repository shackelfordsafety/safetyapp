import { lazy, useRef, useState } from 'react';
import {
  DISCIPLINARY_STEPS, WARNING_LEVELS,
  getDisciplinaryReadinessChecks, isDisciplinaryReady, isDisciplinaryPrintFinal,
  disciplinaryStepStatus, employeeSignMethod, EMPLOYEE_SIGN_METHODS,
} from './disciplinaryModel';
import { disciplinaryFacsimileBlocks } from './disciplinaryPdfDraw';
import {
  Field, TextAreaField, SegmentedToggle, StepPanel, NumberedSection, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth, EmployeeOwned, SignerCard,
} from '../FormPrimitives';
import { LockedContext } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';
import { localISODate } from '../../shared/localDate';
import { loadModule } from '../../shared/loadModule';
import SafeSuspense from '../../shared/SafeSuspense';

/* Lazy like everything that talks to the cloud: a manager filling this in
   with no signal never downloads the handoff machinery. Wrapped in
   SafeSuspense below, so if it cannot load (no signal the first time after
   an update) only that one box says so -- not the whole form. */
const EmployeeHandoffPanel = lazy(() => loadModule(() => import('../../employee/EmployeeHandoffPanel')));

/* ── Step: Notice Details — employee info, warning level, sections 1-3 ──
   Section 4 (Employee Statement) is taken on the Signatures step, as part
   of the employee's own part. Left blank it still prints as a ruled box,
   so writing it by hand is never taken away. */
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

      {/* Section 4 (Employee Statement) is the employee's, so it lives with
          the rest of their part on the Signatures step -- typed there, or
          written on their own phone. Fonzo, 2026-09-28: "this box should
          show up where the employee scans the qr code." */}

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
  return localISODate();
}

/* When the employee sent his part back, said the way a person says it.
   Date and time both, because "he signed it at 2:14" is the kind of detail
   that settles an argument months later. */
function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'their own device';
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

/* Would this change to the employee's part change what the employee line
   prints? Their method, whether they refused, or their signature itself.
   Compared by what it MEANS, not by raw field: tapping the method that is
   already chosen, or re-saving the same state, is not a change. */
function employeeLineChanges(model, patch) {
  const after = { ...model, ...patch };
  /* Only what the witness's own sentence depends on: whether the employee
     signed or refused (see witnessStatementFor). A phone answer landing
     after the witness signed, or switching between "on this device" and
     "on their phone", leaves that sentence true -- clearing the witness
     for it would drag somebody back who may have left the building. */
  return Boolean(after.employeeRefusedToSign) !== Boolean(model.employeeRefusedToSign);
}

function StepSignatures({ model, upd, prev, next }) {
  const method = employeeSignMethod(model);
  /* THE WITNESS SIGNS FOR WHAT THEY SAW (audit 2026-09-30, C4). Their
     statement -- "signed to acknowledge receipt" or "did not sign" -- is
     stamped from the employee's part at the moment they sign. Change the
     employee's part afterwards and the page would print a witness
     statement that contradicts the employee line right above it. So a
     change that matters takes the witness signature off, and says why. */
  const [witnessMustResign, setWitnessMustResign] = useState(false);
  function updEmployee(patch) {
    if (model.witnessSignatureData && employeeLineChanges(model, patch)) {
      upd({ ...patch, witnessSignatureData: null, witnessSignatureDate: '', witnessStatement: '' });
      setWitnessMustResign(true);
      return;
    }
    upd(patch);
  }
  const who = model.employeeName || 'The employee';
  const statementField = (
    <TextAreaField
      label="Their statement (optional)"
      rows={3}
      value={model.employeeStatement}
      onChange={v => upd({ employeeStatement: v })}
      voice
    />
  );
  /* Three people, three boxes, in the order they sign. Fonzo, 2026-09-28:
     the old version was "a bunch of word slop on a page". Every line of
     explanation that used to sit between the pads is either one short
     line inside its box or gone. */
  return (
    <StepPanel title="Signatures" intro="Three people sign: you, the employee, and a witness.">
      {/* Deliberately NOT the Supervisor field from Notice Details. That one
          says who the employee works for; this says who is giving the notice.
          They are often different people. */}
      <SignerCard title="1. You" sub="Whoever is giving this notice. Your name prints under your signature.">
        <Field label="Your Name and Title" value={model.managerName} onChange={v => upd({ managerName: v })} placeholder="Name - Title" />
        <div className="formPairRow">
          <SignaturePad label="Your Signature" value={model.managerSignatureData} onChange={data => upd({ managerSignatureData: data, managerSignatureDate: data ? today() : model.managerSignatureDate })} />
          <Field label="Date" type="date" value={model.managerSignatureDate} onChange={v => upd({ managerSignatureDate: v })} />
        </div>
      </SignerCard>

      <SignerCard title={`2. ${model.employeeName || 'Employee'}`} sub="Their statement and signature. Signing means they got this notice, not that they agree.">
        {/* ONE QUESTION, THEN ONE ROAD: only the chosen path shows. Sealed
            once they have answered on their own phone. */}
        <EmployeeOwned when={model.employeeResponseAt}>
          <SegmentedToggle
            label="How are they doing it?"
            value={method}
            onChange={v => updEmployee({ employeeSignMethod: v, employeeRefusedToSign: v === 'none' })}
            options={EMPLOYEE_SIGN_METHODS}
          />
        </EmployeeOwned>

        {method === 'phone' && (
          <SafeSuspense fallback={null}>
            <EmployeeHandoffPanel
              docType="disciplinary"
              model={model}
              employeeName={model.employeeName}
              needs={['statement', 'signature']}
              respondedAt={model.employeeResponseAt}
              /* The code waiting on their phone is saved on the notice, so
                 leaving this step (or reloading) does not lose their answer. */
              pending={model.employeeHandoff}
              onPendingChange={p => upd({ employeeHandoff: p })}
              onReceived={answer => updEmployee({
                /* An empty statement must not wipe one typed earlier. */
                ...(answer.statement ? { employeeStatement: answer.statement } : {}),
                ...(answer.signatureData
                  ? { employeeSignatureData: answer.signatureData, employeeSignatureDate: today(), employeeRefusedToSign: false }
                  : {}),
                /* The stamp that makes all of the above theirs, and read-only
                   from here on. */
                employeeResponseAt: answer.respondedAt || new Date().toISOString(),
              })}
            />
          </SafeSuspense>
        )}

        {/* What came back off the phone, shown but sealed. */}
        {method === 'phone' && model.employeeResponseAt && (
          <EmployeeOwned when>
            {model.employeeStatement && statementField}
            <div className="formPairRow">
              <SignaturePad label="Their Signature" value={model.employeeSignatureData} onChange={() => {}} />
              <Field label="Date" type="date" value={model.employeeSignatureDate} onChange={() => {}} />
            </div>
            <p className="helperText">Done on their phone {fmtWhen(model.employeeResponseAt)}. Locked — nobody here can change it.</p>
          </EmployeeOwned>
        )}

        {method === 'device' && (
          <>
            {statementField}
            <div className="formPairRow">
              <SignaturePad label="Their Signature" value={model.employeeSignatureData} onChange={data => updEmployee({ employeeSignatureData: data, employeeSignatureDate: data ? today() : model.employeeSignatureDate })} />
              <Field label="Date" type="date" value={model.employeeSignatureDate} onChange={v => upd({ employeeSignatureDate: v })} />
            </div>
          </>
        )}

        {method === 'none' && (
          <>
            {/* A statement typed before they refused still prints, so it
                stays on screen rather than printing unseen. */}
            {model.employeeStatement && statementField}
            <p className="helperText">
              Prints &ldquo;Refused / Unavailable to Sign.&rdquo; The witness below covers it.
              {model.employeeSignatureData ? ' A signature saved earlier will not print.' : ''}
            </p>
          </>
        )}
      </SignerCard>

      {/* What the witness attests to (witnessStatementFor) is stamped onto
          the record when they sign and prints above their signature. */}
      <SignerCard title="3. Witness" sub="Someone else who was in the room.">

        <Field label="Witness Name and Title" value={model.witnessName} onChange={v => upd({ witnessName: v })} placeholder="Name - Title" />
        {witnessMustResign && !model.witnessSignatureData && (
          <div className="pdfStaleWarning" role="status">
            <strong>The witness needs to sign again</strong>
            <span>The employee&apos;s answer changed after the witness signed, so the witness signature was taken off.</span>
          </div>
        )}
        <SignaturePad
          label="Witness Signature"
          value={model.witnessSignatureData}
          onChange={data => {
            if (data) setWitnessMustResign(false);
            upd({
              witnessSignatureData: data,
              witnessSignatureDate: data ? today() : model.witnessSignatureDate,
              witnessStatement: data ? witnessStatementFor(model) : '',
            });
          }}
        />
      </SignerCard>

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
