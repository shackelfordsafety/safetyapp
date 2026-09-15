import { lazy, Suspense, useRef } from 'react';
import {
  SEPARATION_STEPS, SEPARATION_TYPES, SEPARATION_REASON_GROUPS,
  REHIRE_STATUSES, PROPERTY_RETURNED_OPTIONS, ACCESS_REMOVED_OPTIONS,
  getSeparationReadinessChecks, isSeparationReady, isSeparationPrintFinal, expensesAnswer,
  separationStepStatus, employeeSignMethod, EMPLOYEE_SIGN_METHODS,
} from './separationModel';
import { separationFacsimileBlocks } from './separationPdfDraw';
import {
  Field, TextAreaField, SegmentedToggle, ChipGroup, StepPanel, StepFooter,
  BuilderHeader, StepNav, ReviewExportPanel, ReadinessChecklist, SignaturePad, DocFacsimile,
  useIsTouchPrimary, useElementWidth, EmployeeOwned,
} from '../FormPrimitives';
import { LockedContext } from '../lockedContext';
import { downloadDraftFile, buildDraftFilename } from '../../shared/draftTransfer';

const EmployeeHandoffPanel = lazy(() => import('../../employee/EmployeeHandoffPanel'));

function toggleInList(list, item) {
  return (list || []).includes(item) ? list.filter(x => x !== item) : [...(list || []), item];
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
            <Field label="Position" value={model.position} onChange={v => upd({ position: v })} />
          </div>
          <div className="formPairRow">
            <Field label="Project / Location" value={model.projectLocation} onChange={v => upd({ projectLocation: v })} />
            <Field label="Supervisor" value={model.supervisor} onChange={v => upd({ supervisor: v })} />
          </div>
          <div className="formPairRow">
            <Field label="Last Day Worked" type="date" value={model.lastDayWorked} onChange={v => upd({ lastDayWorked: v })} />
            <Field label="Effective Separation Date" type="date" value={model.effectiveSeparationDate} onChange={v => upd({ effectiveSeparationDate: v })} />
          </div>
          <div className="formPairRow">
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
        <SegmentedToggle
          label="Final timesheet submitted"
          value={model.finalTimesheetSubmitted ? 'yes' : 'no'}
          onChange={v => upd({ finalTimesheetSubmitted: v === 'yes' })}
          options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }]}
        />
        <SegmentedToggle
          label="Expenses / receipts resolved"
          value={expensesAnswer(model)}
          onChange={v => upd({ expensesResolved: v })}
          options={[
            { value: 'yes', label: 'Yes', tone: 'yes' },
            { value: 'no', label: 'No', tone: 'no' },
            { value: 'na', label: 'N/A' },
          ]}
        />
        <TextAreaField label="Any company property or paperwork still outstanding?" rows={3} value={model.outstandingPropertyNotes} onChange={v => upd({ outstandingPropertyNotes: v })} voice />
      </div>

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Signatures" />
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
            ? 'Everything is filled in and signed. Send it when you are ready.'
            : `${remainingCount} ${remainingCount === 1 ? 'item' : 'items'} still needed — tap one to go straight to it.`}
        </p>
        <ReadinessChecklist checks={checks} onJump={onJumpCheck} />
      </div>
      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Submit" />
    </StepPanel>
  );
}

/* ── Step: Signature — supervisor only. Employee and HR always sign the
   printed copy by hand (Fonzo, 2026-08-29: "the only thing i wanted
   digitized is the superintendent, foreman, safety parts"). ── */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/* When the employee sent his signature back, said the way a person says
   it. Date and time both -- "he signed at 2:14" is the kind of detail that
   settles an argument months later. */
function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'their own device';
  return d.toLocaleString(undefined, {
    month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/* What the witness is actually attesting to. A signature under the word
   "Witness" proves nothing on its own -- it has to say what was witnessed,
   or it is worth nothing the day somebody disputes the separation. */
function witnessStatementFor(model) {
  const who = model.employeeName ? model.employeeName : 'the employee';
  const outcome = model.employeeRefusedToSign
    ? `${who} was informed and did not sign — refused or not available.`
    : `${who} was informed and signed to acknowledge receipt.`;
  return `I was present when this separation was discussed. ${outcome}`;
}

/* ── Step: Signatures — the three people who are in the room ──────────────
   Fonzo, 2026-09-14, looking at a real separation he had just run:
   "There should be three things on there. The manager that's talking to
   the employee, the employee, and the witness."

   It had four, in the wrong order, with HR in the middle of them. HR is
   not in that room -- the notice reaches HR afterwards, and Pat signs it
   on her own screen when she files it. Putting her pad here meant the one
   person running the meeting had to scroll past a slot nobody present
   could use, twice, while a man waited to sign.

   So: management, employee, witness, in the order they actually sign.

   And that is the entire list. Fonzo, 2026-09-15, having asked her: "I
   talked to Miss Pat, the HR manager, she said she doesn't need to sign on
   anything, signing people are only in the field, she's just the approver."
   The HR fields are still on the model so an old draft loads, but nothing
   captures them and nothing prints them any more. */
function StepSignatures({ model, upd, prev, next }) {
  const method = employeeSignMethod(model);
  return (
    <StepPanel
      title="Signatures"
      intro="The three people in the room sign here — you, the employee, and a witness. Nobody else signs a separation."
    >
      <div className="formPairRow">
        <SignaturePad label="Management Signature" value={model.supervisorSignatureData} onChange={data => upd({ supervisorSignatureData: data, supervisorSignatureDate: data ? new Date().toISOString().slice(0, 10) : model.supervisorSignatureDate })} />
        <Field label="Management Signature Date" type="date" value={model.supervisorSignatureDate} onChange={v => upd({ supervisorSignatureDate: v })} />
      </div>
      {/* Deliberately NOT the Supervisor field from step one. That one says
          who the employee worked for; this says who ran the meeting and is
          signing above. They are usually different people, and printing the
          first over the second put the wrong man's name on a real record. */}
      <Field
        label="Management Name and Title"
        value={model.managerName}
        onChange={v => upd({ managerName: v })}
        placeholder="e.g. Alfonso Hernandez - Safety Manager"
      />
      <p className="helperText">
        The manager holding this meeting &mdash; not the employee&rsquo;s supervisor, unless
        they happen to be the same person. This is the name that prints under the
        signature.
      </p>

      {/* ONE QUESTION, THEN ONE ROAD. The QR panel and the signature pad
          used to sit on screen together, which read as though the employee
          was going to scan a code AND sign the iPad. Fonzo, 2026-09-15:
          "give people forks in the road to where they can make a decision
          and stick with it. But they can also go back if needed."

          The question stays put and stays changeable; only the chosen path
          appears under it. It also replaces the old "is the employee
          available to sign?" toggle -- that was the same decision asked
          half-way, in a place where "no" and "on their phone" could somehow
          both be true at once.

          Sealed once they have signed on their phone: switching this
          afterwards would print "Refused / Unavailable to Sign" over
          somebody who demonstrably did sign. */}
      <EmployeeOwned when={model.employeeResponseAt}>
        <SegmentedToggle
          label="How is the employee signing?"
          value={method}
          onChange={v => upd({ employeeSignMethod: v, employeeRefusedToSign: v === 'none' })}
          options={EMPLOYEE_SIGN_METHODS}
        />
      </EmployeeOwned>

      {!method && (
        <p className="helperText">
          Pick one and the rest of this step follows it. You can change it afterwards.
        </p>
      )}

      {/* A separation asks the employee for a signature only. There is no
          employee statement on this form the way there is on a disciplinary,
          and inventing a box for one would take words down that the printed
          form has nowhere to put. */}
      {method === 'phone' && (
        <Suspense fallback={null}>
          <EmployeeHandoffPanel
            docType="separation"
            model={model}
            employeeName={model.employeeName}
            needs={['signature']}
            respondedAt={model.employeeResponseAt}
            onReceived={answer => (answer.signatureData ? upd({
              employeeSignatureData: answer.signatureData,
              employeeSignatureDate: today(),
              employeeRefusedToSign: false,
              /* The stamp that seals it. See EmployeeOwned. */
              employeeResponseAt: answer.respondedAt || new Date().toISOString(),
            }) : null)}
          />
        </Suspense>
      )}

      {method === 'phone' && model.employeeResponseAt && (
        <>
          <EmployeeOwned when>
            <div className="formPairRow">
              <SignaturePad
                label={model.employeeName ? `${model.employeeName} — Employee Signature` : 'Employee Signature'}
                value={model.employeeSignatureData}
                onChange={() => {}}
              />
              <Field label="Employee Signature Date" type="date" value={model.employeeSignatureDate} onChange={() => {}} />
            </div>
          </EmployeeOwned>
          <p className="helperText">
            Signed by {model.employeeName || 'the employee'} on their own phone on{' '}
            {fmtWhen(model.employeeResponseAt)}. That signature is theirs &mdash; nobody here
            can replace or remove it. Send a new code if it has to be done again.
          </p>
        </>
      )}

      {method === 'device' && (
        <>
          <div className="formPairRow">
            <SignaturePad
              label={model.employeeName ? `${model.employeeName} — Employee Signature` : 'Employee Signature'}
              value={model.employeeSignatureData}
              onChange={data => upd({ employeeSignatureData: data, employeeSignatureDate: data ? today() : model.employeeSignatureDate })}
            />
            <Field label="Employee Signature Date" type="date" value={model.employeeSignatureDate} onChange={v => upd({ employeeSignatureDate: v })} />
          </div>
          <p className="helperText">
            Signing acknowledges <strong>receipt</strong> of this notice. It does not mean the
            employee agrees with it, and the printed form says so.
          </p>
        </>
      )}

      {method === 'none' && (
        <p className="helperText">
          The form will print <strong>Refused / Unavailable to Sign</strong> on the
          employee&rsquo;s line instead of leaving it blank, so the record says why it is
          empty &mdash; and the witness below is what stands in its place.
          {model.employeeSignatureData ? ' There is a signature saved on this form from earlier — it will not print while this is selected.' : ''}
        </p>
      )}

      {/* The witness. Fonzo, 2026-09-11: "if the employee doesn't sign, the
          witness was there." Another Shackelford person who was in the
          room -- a clerk, a second supervisor -- not a third party.

          The statement is written down at the moment it is signed, not
          worked out at print time, because what somebody attested to must
          not change later when a toggle above gets edited. */}
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
      <p className="helperText">
        {witnessStatementFor(model)}
      </p>

      {/* HR's own signature and name used to sit here, under the witness,
          on the screen of the man running the meeting. They are not gone --
          they print, and they are filled in by whoever files this at the
          office. They just do not belong in front of three people standing
          in a trailer. */}

      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel="Go to Review" />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function SeparationWorkflow({
  model, upd, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew, onHandedOff,
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
          <span>A preview of the printed form — not the exact page layout</span>
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
        <StepNav steps={SEPARATION_STEPS} activeStepId={step} checks={checks} onJump={guardedJump} lockedIds={lockedIds} />
        <div className={`workflowShell${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
          <div className="workflowLeft">
            {step === 'details' && <StepDetails model={model} upd={upd} next={next} />}
            {step === 'closeout' && <StepCloseout model={model} upd={upd} prev={prev} next={next} />}
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
                archiveFiling={{ docType: 'separation', model }}
                onHandedOff={onHandedOff}
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
