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

    // Seven numbered sections, verbatim order from the reference form.
    // Section 4 (Employee Statement) is the employee's own words, in their
    // own hand -- the app doesn't offer a way to type it in (Fonzo,
    // 2026-08-29: "the only thing i wanted digitized is the superintendent,
    // foreman, safety parts... let everyone else fill out what's required
    // from them on the paper printout"). employeeStatement stays in the
    // shape only so a pre-existing draft that already has one (typed before
    // this decision) keeps printing it rather than silently losing it.
    whatOccurred: '', // 1. What occurred
    earlierWarnings: '', // 2. Earlier verbal or written warnings/discussions on this issue
    companyPolicyStates: '', // 3. Company policy states
    employeeStatement: '', // 4. Employee statement -- legacy field, no longer editable in-app, see above
    correctiveActionRequired: '', // 5. Corrective action that must be taken by the employee
    companyWill: '', // 6. The company will
    ifNotCorrected: '', // 7. If behavior is not corrected / performance does not improve

    // Employee signature is never captured in-app (same 2026-08-29 decision
    // as employeeStatement above) -- the printed notice always has a blank
    // line for the employee to sign by hand. employeeRefusedToSign/
    // employeeSignatureData/employeeSignatureDate stay in the shape only so
    // a pre-existing draft that already captured one keeps printing it.
    employeeRefusedToSign: false,
    employeeSignatureData: null,
    employeeSignatureDate: '',
    // Manager signature is the one thing on this notice that's actually
    // digitized -- Fonzo/whoever is filling this out is always right there
    // with the device, so it's always required, always captured here.
    managerSignatureData: null,
    managerSignatureDate: '',

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

// Content -> Review -> Signatures -> Export, no exceptions (Fonzo, standing
// rule, 2026-08-20) -- signatures always come last so the crew/employee
// reviews what they're signing before they sign it.
export const DISCIPLINARY_STEPS = [
  { id: 'notice', label: 'Notice Details', helper: 'Employee info, warning level, and what occurred' },
  { id: 'response', label: 'Corrective Action', helper: 'Required correction and consequence' },
  { id: 'review', label: 'Review', helper: 'Check everything before anyone signs' },
  { id: 'signatures', label: 'Signature', helper: 'Manager signs — employee signs the printed copy' },
  { id: 'export', label: 'Finish & Export', helper: 'Save, generate, and download the PDF' },
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
    { key: 'managerSignature', label: 'Manager signature', ok: Boolean(model.managerSignatureData), step: 'signatures' },
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
  return next ? next.label : 'Finish & Export';
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
