/* ── Employee Disciplinary Notice data model ──
   Field-for-field from the company Employee Disciplinary Notice form:
   employee/supervisor/position/date, a four-level warning checkbox, and
   seven numbered sections, then employee + manager signature/date. Wording
   and section order are transcribed from the mission brief's source
   description and must not be reworded or reordered without a deliberate
   content decision.

   This module owns the data shape only — no storage, no React, no PDF
   rendering — mirroring incidentModel.js's own separation of concerns. */

export const DISCIPLINARY_SCHEMA_VERSION = 1;

function makeId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export const WARNING_LEVELS = [
  { value: 'verbal', label: 'Verbal Warning' },
  { value: 'written', label: 'Written Warning' },
  { value: 'secondWritten', label: '2nd Written Warning' },
  { value: 'final', label: 'Final Warning' },
];

export function warningLevelLabel(v) {
  return WARNING_LEVELS.find(w => w.value === v)?.label || '';
}

export function emptyDisciplinary() {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    schemaVersion: DISCIPLINARY_SCHEMA_VERSION,
    status: 'draft', // 'draft' | 'ready' | 'completed'
    createdAt: now,
    lastSavedAt: '',
    completedAt: '',

    // Employee information
    employeeName: '',
    supervisor: '',
    position: '',
    noticeDate: todayISO(),

    // Warning level (single-select)
    warningLevel: '', // '' | 'verbal' | 'written' | 'secondWritten' | 'final'

    /* Seven numbered sections, verbatim order from the reference form.

       Section 4 (Employee Statement) was made un-editable on 2026-08-29,
       when only staff signatures were digitized: "let everyone else fill
       out what's required from them on the paper printout." Every other
       part of that rule has since been reversed -- the employee signs on
       screen, the witness signs on screen, and Fonzo, 2026-09-14: "What
       printed copy? There's no printed copy, but it's all digital."

       So it is typable again (2026-09-15, Fonzo: "theres not a employee
       statement box in the workflow on discipline forms"). It stays
       OPTIONAL: left empty, the notice still prints section 4 as a blank
       ruled box for a man who would rather write it himself, which is the
       behaviour that has been shipping and should not be taken away. */
    whatOccurred: '', // 1. What occurred
    earlierWarnings: '', // 2. Earlier verbal or written warnings/discussions on this issue
    companyPolicyStates: '', // 3. Company policy states
    employeeStatement: '', // 4. Employee statement -- typed here, or left blank to be handwritten
    correctiveActionRequired: '', // 5. Corrective action that must be taken by the employee
    companyWill: '', // 6. The company will
    ifNotCorrected: '', // 7. If behavior is not corrected / performance does not improve

    // Employee signature is never captured in-app (same 2026-08-29 decision
    // as employeeStatement above) -- the printed notice always has a blank
    // line for the employee to sign by hand. employeeRefusedToSign/
    // employeeSignatureData/employeeSignatureDate stay in the shape only so
    // a pre-existing draft that already captured one keeps printing it.
    /* '' | 'phone' | 'device' | 'none' -- see employeeSignMethod() below.
       employeeRefusedToSign is kept in step with it because the printed
       form reads that flag, not this one. */
    employeeSignMethod: '',
    employeeRefusedToSign: false,
    employeeSignatureData: null,
    employeeSignatureDate: '',
    /* When the employee sent his part back from his own phone. Its presence
       is what makes his statement and his signature read-only on this
       screen -- see EmployeeOwned in FormPrimitives.jsx, and Fonzo's
       reason for it: "make sure everything the employee does can't be
       changed by the employer, for legal reasons."

       Null for a notice where he signed on the manager's device instead.
       That case cannot be locked and should not pretend to be: the iPad
       was in management's hands the whole time. */
    employeeResponseAt: '',
    /* WHO IS GIVING THE NOTICE, which is not `supervisor` above.
       `supervisor` describes who the employee works for. This is the
       manager holding the meeting and putting his name to it -- often not
       the employee's own boss.

       Added 2026-09-14, the same gap the separation form had. There, with
       nowhere to record it, the name got typed into the HR box instead --
       and when the printed form finally started showing names, it printed
       the SUPERVISOR over the signer's signature, naming the wrong man as
       the one who gave the notice. Fixed there, so fixed here before it
       does the same thing on a live write-up. */
    managerName: '',
    // Manager signature is the one thing on this notice that's actually
    // digitized -- Fonzo/whoever is filling this out is always right there
    // with the device, so it's always required, always captured here.
    managerSignatureData: null,
    managerSignatureDate: '',

    /* The witness, matching separation. Fonzo, 2026-09-11, going digital on
       both: "if the employee doesn't sign, the witness was there." Another
       Shackelford person who was in the room -- a clerk, a second
       supervisor -- explicitly not a third party.

       An employee refusing to sign a write-up is the normal case, not the
       edge one, and a blank line proves nothing about whether he was ever
       told. witnessStatement is stored rather than derived at print time so
       what somebody attested to cannot drift if the form is edited later. */
    witnessName: '',
    witnessSignatureData: null,
    witnessSignatureDate: '',
    witnessStatement: '',

    // Internal-only, never printed
    notes: '',
  };
}

// Every real user-entered field, not just a handful -- this drives the
// unsaved-changes guard on Start Blank/Start New, so a gap here means real
// field data can be silently wiped with no warning. Excludes noticeDate
// (defaults to today, never empty) and internal-only `notes`.
export function hasMeaningfulDisciplinaryContent(model) {
  if (!model) return false;
  return [
    model.employeeName, model.supervisor, model.position,
    model.whatOccurred, model.earlierWarnings, model.companyPolicyStates, model.employeeStatement,
    model.correctiveActionRequired, model.companyWill, model.ifNotCorrected,
  ].some(v => String(v || '').trim().length > 0)
    || Boolean(model.warningLevel)
    || Boolean(model.employeeRefusedToSign)
    || Boolean(model.employeeSignatureData)
    || Boolean(model.managerSignatureData);
}

// SUPERSEDED, left here only to say so: this used to read "Content ->
// Review -> Signatures -> Export, no exceptions (Fonzo, standing rule,
// 2026-08-20)". That rule was replaced on 2026-09-14 and the array below
// has not matched it since -- see the comment inside it for the reason.
// The two sat three lines apart contradicting each other until 2026-09-25,
// which is exactly how somebody later "fixes" the order and breaks it.
export const DISCIPLINARY_STEPS = [
  { id: 'notice', label: 'Notice Details', helper: 'Employee info, warning level, and what occurred' },
  { id: 'response', label: 'Corrective Action', helper: 'Required correction and consequence' },
  /* Signatures BEFORE review, matching the separation form. Fonzo's rule,
     2026-09-14: a document signed in a room with the employee is filled in,
     signed, and THEN read back over by the one person left holding it.
     (The JSA is deliberately the other way round -- it is read out loud at
     the tailgate and then signed by the crew.)

     The helper also used to say "employee signs the printed copy", written
     when nothing here was signed on a screen. There is a live signature pad
     for the employee on that step. */
  { id: 'signatures', label: 'Signatures', helper: 'Management, employee and witness sign' },
  { id: 'review', label: 'Review', helper: 'Read the finished notice over before sending it' },
  { id: 'export', label: 'Submit', helper: 'Send it for review, or make a paper copy' },
];

// A verbal warning is a coaching conversation, not a signed notice -- the
// employee never signs it (see disciplinaryPdfDraw.js's employeeSigNote).
export function isVerbalWarning(model) {
  return model.warningLevel === 'verbal';
}

// Employee signature is never required in-app -- it's always collected on
// the printed paper copy (see emptyDisciplinary's comment). Only the
// manager's signature -- the one part of this notice that's actually
// digitized -- gates completion.
export function getDisciplinaryReadinessChecks(model) {
  const has = v => String(v || '').trim().length > 0;
  return [
    { key: 'employeeName', label: 'Employee name', ok: has(model.employeeName), step: 'notice' },
    { key: 'supervisor', label: 'Supervisor', ok: has(model.supervisor), step: 'notice' },
    { key: 'noticeDate', label: 'Date', ok: has(model.noticeDate), step: 'notice' },
    { key: 'warningLevel', label: 'Warning level selected', ok: has(model.warningLevel), step: 'notice' },
    { key: 'whatOccurred', label: 'Section 1 — What occurred', ok: has(model.whatOccurred), step: 'notice' },
    { key: 'correctiveActionRequired', label: 'Section 5 — Corrective action required', ok: has(model.correctiveActionRequired), step: 'response' },
    { key: 'managerSignature', label: 'Management signature', ok: Boolean(model.managerSignatureData), step: 'signatures' },
  ];
}

export function isDisciplinaryReady(model) {
  return getDisciplinaryReadinessChecks(model).every(c => c.ok);
}

// Derived directly from getDisciplinaryReadinessChecks (each check already
// carries the step it belongs to) rather than a second, separately
// hand-picked field list -- this used to consider "notice" complete without
// checking noticeDate, which getDisciplinaryReadinessChecks does require.
// 'export' is the terminal step -- it has no checks of its own, so it
// reflects the whole document's readiness rather than "complete because
// nothing was ever tied to it" (mirrors stepRowState's terminal-step
// handling in FormPrimitives.jsx).
export function disciplinaryStepStatus(model, stepId) {
  if (stepId === 'export') return isDisciplinaryReady(model) ? 'complete' : 'needs-info';
  const relevant = getDisciplinaryReadinessChecks(model).filter(c => c.step === stepId);
  if (!relevant.length) return 'complete';
  return relevant.every(c => c.ok) ? 'complete' : 'needs-info';
}

export function disciplinaryStepProgress(model) {
  const total = DISCIPLINARY_STEPS.length - 1;
  const done = DISCIPLINARY_STEPS.slice(0, -1).filter(s => disciplinaryStepStatus(model, s.id) === 'complete').length;
  return { done, total };
}

export function disciplinaryNextStepHint(model) {
  const next = DISCIPLINARY_STEPS.find(s => disciplinaryStepStatus(model, s.id) !== 'complete');
  return next ? next.label : 'Submit';
}

/* "Final" print state mirrors Incident's own status gate — 'ready' and
   'completed' print identically un-watermarked; editing a printed field
   after either reverts to 'draft' (see useDraftDocument's upd()). */
export function isDisciplinaryPrintFinal(model) {
  return model.status === 'ready' || model.status === 'completed';
}

export function buildDisciplinaryExportName(model) {
  const name = (model.employeeName || 'Employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const date = model.noticeDate || todayISO();
  const draftSuffix = isDisciplinaryPrintFinal(model) ? '' : '_DRAFT';
  return `${name}_DisciplinaryNotice_${date}${draftSuffix}`;
}

/* HOW IS THE EMPLOYEE DOING THEIR PART? A fork, not a pile of options.

   Fonzo, 2026-09-15, looking at a screen that showed the QR code AND the
   signature pads at the same time: "if we ever have options for anything,
   we gotta make sure to ask, like, hey, what would you like to do? Are they
   gonna sign on their phone, or are they gonna sign this device? Don't just
   put it all out there for somebody to figure out, because it just looks
   like they're scanning it there and then they're also signing the iPad.
   Kinda give people forks in the road to where they can make a decision and
   stick with it. But they can also go back if needed."

   '' means nobody has been asked yet, and nothing below the question is on
   screen until they answer. The answer is always still there to change --
   a fork, not a trapdoor -- except once the employee has actually answered
   on their phone, which is theirs and sealed (see EmployeeOwned).

   Derived rather than required, so a notice saved before this question
   existed opens on the path it was already taking. */
export function employeeSignMethod(model) {
  if (model?.employeeSignMethod) return model.employeeSignMethod;
  if (model?.employeeResponseAt) return 'phone';
  if (model?.employeeRefusedToSign) return 'none';
  if (model?.employeeSignatureData) return 'device';
  return '';
}

export const EMPLOYEE_SIGN_METHODS = [
  { value: 'phone', label: 'On their own phone' },
  { value: 'device', label: 'On this device' },
  { value: 'none', label: 'They are not signing', tone: 'no' },
];
