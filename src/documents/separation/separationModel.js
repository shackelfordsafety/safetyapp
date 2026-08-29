/* ── Employee Separation data model ──
   The historical company document combines Employee Data Change and
   Employee Separation on one form. This app implements ONLY the
   separation portion — no address/phone/pay-rate/tax-withholding/
   benefits/loan/payroll-status fields, which belong to actual HR/payroll
   systems, not a safety documentation tool (see the mission brief's
   explicit scope boundary).

   MIGRATED to the CURRENT company Employee Separation Form (see
   migrateSeparationShape below) — the app was originally built from an
   older, simplified version of this form. The current form adds: Employee
   ID, Project/Location, Last Day Worked, Date Submitted, a Voluntary/
   Involuntary split, a much longer categorized reason list, documentation-
   attached / rehire-reason-if-no, a full Company Closeout section
   (property returned, access removed, final timesheet, expenses,
   outstanding property notes), an "employee refused/unavailable to sign"
   flag, and a third HR/Management signature column. */

export const SEPARATION_SCHEMA_VERSION = 2;

function makeId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export const SEPARATION_TYPES = [
  { value: 'voluntary', label: 'Voluntary' },
  { value: 'involuntary', label: 'Involuntary' },
];

// Grouped exactly as the current source form lays them out (three rows of
// related reasons, plus Other) — see SeparationWorkflow.jsx for how the
// groups render. The underlying field stays a single choice (one primary
// reason), matching how this app already worked; the paper form's checkbox
// glyphs are a print convention; presented as a single-select list.
export const SEPARATION_REASON_GROUPS = [
  ['Resignation', 'Retirement', 'Lack of Work / Reduction', 'End of Project'],
  ['Discharge', 'Job Abandonment / No Call-No Show', 'Attendance'],
  ['Performance', 'Safety Violation', 'Misconduct / Policy Violation'],
];
export const SEPARATION_REASONS = [...SEPARATION_REASON_GROUPS.flat(), 'Other'];

export const REHIRE_STATUSES = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'pendingReview', label: 'Pending HR Review' },
];

export const PROPERTY_RETURNED_OPTIONS = [
  'Vehicle / Keys', 'Fuel / Credit Card', 'Phone / Tablet', 'Badge / Keys', 'Tools / PPE', 'Other',
];
export const ACCESS_REMOVED_OPTIONS = [
  'Email', 'Payroll / Timekeeping', 'Project / Client Systems', 'Gate / Site Access', 'Other',
];

export function emptySeparation() {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    schemaVersion: SEPARATION_SCHEMA_VERSION,
    status: 'draft', // 'draft' | 'ready' | 'completed'
    createdAt: now,
    lastSavedAt: '',
    completedAt: '',

    // Employee Information
    employeeName: '',
    employeeId: '',
    position: '',
    projectLocation: '',
    supervisor: '',
    lastDayWorked: '',
    effectiveSeparationDate: todayISO(),
    dateSubmitted: todayISO(),

    // Separation Details
    separationType: '', // '' | 'voluntary' | 'involuntary'
    separationReason: '', // one of SEPARATION_REASONS
    separationReasonOther: '',
    detailedExplanation: '',

    // Discipline / Rehire Status
    warningNoticesGiven: '', // '' | 'yes' | 'no' | 'na'
    warningNoticesCount: '',
    documentationAttached: '', // '' | 'yes' | 'no'
    eligibleForRehire: '', // '' | 'yes' | 'no' | 'pendingReview'
    rehireReasonIfNo: '',

    // Company Closeout
    propertyReturned: [],
    propertyReturnedOther: '',
    accessRemoved: [],
    accessRemovedOther: '',
    finalTimesheetSubmitted: false,
    expensesResolved: false,
    outstandingPropertyNotes: '',

    // Acknowledgement / Approvals. Employee and HR signatures are never
    // captured in-app -- both print as blank lines for a hand signature
    // (Fonzo, 2026-08-29: "the only thing i wanted digitized is the
    // superintendent, foreman, safety parts... let everyone else fill out
    // what's required from them on the paper printout" -- HR specifically
    // closes a separation out later, off-app, which is exactly that case).
    // employeeRefusedToSign/employeeSignatureData/hrSignatureData stay in
    // the shape only so a pre-existing draft that already captured one
    // keeps printing it rather than silently losing it.
    employeeRefusedToSign: false,
    employeeSignatureData: null,
    employeeSignatureDate: '',
    // Supervisor signature is the one thing on this record that's actually
    // digitized -- always required, always captured here.
    supervisorSignatureData: null,
    supervisorSignatureDate: '',
    hrName: '',
    hrSignatureData: null,
    hrSignatureDate: '',

    notes: '',
  };
}

// Old reason values that map cleanly to a same-meaning new category.
const REASON_MIGRATION_MAP = {
  'Lack of Work': 'Lack of Work / Reduction',
  'Discharge': 'Discharge',
  'Resignation': 'Resignation',
  'No Call / No Show': 'Job Abandonment / No Call-No Show',
};

/* Deterministic shape migration for drafts saved under the old (simplified)
   form. Old field values that still mean the same thing keep their data
   (employeeName/supervisor/position/detailedExplanation/warning fields/
   signatures/notes carry straight across; separationDate becomes
   effectiveSeparationDate). "Lack of Work"/"Discharge"/"Resignation"/
   "No Call / No Show" map to their equivalent new category. "Leave of
   Absence" and "Working Part-time" have NO equivalent in the new category
   list -- rather than guess which new category they belong to, they
   migrate to "Other" with the original text preserved verbatim in the
   "specify" field, so nothing is silently lost or reinterpreted. wouldRehire
   ('yes'|'no') maps directly onto the new eligibleForRehire, which just
   adds a third "Pending HR Review" option the old model never had.
   Every genuinely new field (Employee ID, Project/Location, Last Day
   Worked, separationType, closeout section, HR signature, etc.) is left
   blank/default -- never inferred from old data, per the mission's explicit
   migration rule. Idempotent: already-current-shape drafts (schemaVersion
   2) pass through unchanged. */
export function migrateSeparationShape(raw) {
  if (!raw) return raw;
  if (raw.schemaVersion >= SEPARATION_SCHEMA_VERSION || raw.effectiveSeparationDate !== undefined) return raw;

  const oldReason = raw.separationReason || '';
  const mapped = REASON_MIGRATION_MAP[oldReason];
  const isUnmappedLegacyReason = oldReason && !mapped && SEPARATION_REASONS.includes(oldReason) === false;
  const newReason = mapped || (isUnmappedLegacyReason ? 'Other' : oldReason);
  const newReasonOther = isUnmappedLegacyReason
    ? (raw.separationReasonOther ? `${oldReason} — ${raw.separationReasonOther}` : oldReason)
    : (raw.separationReasonOther || '');

  return {
    ...raw,
    schemaVersion: SEPARATION_SCHEMA_VERSION,
    effectiveSeparationDate: raw.separationDate || todayISO(),
    separationReason: newReason,
    separationReasonOther: newReasonOther,
    eligibleForRehire: raw.wouldRehire === 'yes' ? 'yes' : raw.wouldRehire === 'no' ? 'no' : '',
  };
}

// Every real user-entered field, not just a handful -- this drives the
// unsaved-changes guard on Start Blank/Start New, so a gap here means real
// field data (including the whole Company Closeout section) can be silently
// wiped with no warning. Excludes effectiveSeparationDate/dateSubmitted
// (default to today, never empty) and internal-only `notes`.
export function hasMeaningfulSeparationContent(model) {
  if (!model) return false;
  return [
    model.employeeName, model.employeeId, model.position, model.projectLocation, model.supervisor,
    model.lastDayWorked, model.separationReasonOther, model.detailedExplanation,
    model.warningNoticesCount, model.rehireReasonIfNo, model.propertyReturnedOther,
    model.accessRemovedOther, model.outstandingPropertyNotes, model.hrName,
  ].some(v => String(v || '').trim().length > 0)
    || Boolean(model.separationType) || Boolean(model.separationReason)
    || Boolean(model.warningNoticesGiven) || Boolean(model.documentationAttached)
    || Boolean(model.eligibleForRehire) || Boolean(model.finalTimesheetSubmitted)
    || Boolean(model.expensesResolved) || Boolean(model.employeeRefusedToSign)
    || (model.propertyReturned || []).length > 0 || (model.accessRemoved || []).length > 0
    || Boolean(model.employeeSignatureData) || Boolean(model.supervisorSignatureData) || Boolean(model.hrSignatureData);
}

// Content -> Review -> Signatures -> Export, no exceptions (Fonzo, standing
// rule, 2026-08-20) -- signatures always come last so everyone reviews the
// record before signing it. Also the fix for the missing lock: Separation
// used to have no lockedIds/guardedJump at all, so a direct StepNav jump
// could land straight on a blank Signatures step (see SeparationWorkflow.jsx).
export const SEPARATION_STEPS = [
  { id: 'details', label: 'Separation Details', helper: 'Employee info, separation type, reason, and explanation' },
  { id: 'closeout', label: 'Closeout', helper: 'Rehire status and company closeout' },
  { id: 'review', label: 'Review', helper: 'Check everything before anyone signs' },
  { id: 'signatures', label: 'Signature', helper: 'Supervisor signs — employee and HR sign the printed copy' },
  { id: 'export', label: 'Finish & Export', helper: 'Save, generate, and download the PDF' },
];

// Employee and HR signatures are never required in-app -- both always
// print blank for a hand signature (see emptySeparation's comment). Only
// the supervisor's signature -- the one part of this record that's
// actually digitized -- gates completion.
export function getSeparationReadinessChecks(model) {
  const has = v => String(v || '').trim().length > 0;
  const checks = [
    { key: 'employeeName', label: 'Employee name', ok: has(model.employeeName), step: 'details' },
    { key: 'supervisor', label: 'Supervisor', ok: has(model.supervisor), step: 'details' },
    { key: 'effectiveSeparationDate', label: 'Effective separation date', ok: has(model.effectiveSeparationDate), step: 'details' },
    { key: 'separationReason', label: 'Reason for separation selected', ok: has(model.separationReason), step: 'details' },
    { key: 'detailedExplanation', label: 'Detailed explanation', ok: has(model.detailedExplanation), step: 'details' },
    { key: 'eligibleForRehire', label: 'Re-hire eligibility answered', ok: has(model.eligibleForRehire), step: 'closeout' },
    { key: 'supervisorSignature', label: 'Supervisor signature', ok: Boolean(model.supervisorSignatureData), step: 'signatures' },
  ];
  if (model.separationReason === 'Other') {
    checks.push({ key: 'separationReasonOther', label: 'Other reason (specify)', ok: has(model.separationReasonOther), step: 'details' });
  }
  if (model.separationType === 'involuntary') {
    checks.push({ key: 'warningNoticesGiven', label: 'Were warning notices given?', ok: has(model.warningNoticesGiven), step: 'closeout' });
    if (model.warningNoticesGiven === 'yes') {
      checks.push({ key: 'warningNoticesCount', label: 'Number of warning notices given', ok: has(model.warningNoticesCount), step: 'closeout' });
    }
  }
  if (model.eligibleForRehire === 'no') {
    checks.push({ key: 'rehireReasonIfNo', label: 'Reason not eligible for rehire', ok: has(model.rehireReasonIfNo), step: 'closeout' });
  }
  return checks;
}

export function isSeparationReady(model) {
  return getSeparationReadinessChecks(model).every(c => c.ok);
}

// Derived directly from getSeparationReadinessChecks (each check already
// carries the step it belongs to) rather than a second, separately
// hand-picked field list -- the two had drifted (e.g. this considered
// "closeout" complete without checking the conditionally-required
// warningNoticesGiven/warningNoticesCount for an involuntary separation, or
// rehireReasonIfNo when not eligible for rehire), so a step could show
// complete and then block the user at Review with no clear signal why.
// 'export' is the terminal step -- see disciplinaryStepStatus for why it
// (not 'review', which now comes before Signatures) reflects the whole
// document's readiness.
export function separationStepStatus(model, stepId) {
  if (stepId === 'export') return isSeparationReady(model) ? 'complete' : 'needs-info';
  const relevant = getSeparationReadinessChecks(model).filter(c => c.step === stepId);
  if (!relevant.length) return 'complete';
  return relevant.every(c => c.ok) ? 'complete' : 'needs-info';
}

export function separationStepProgress(model) {
  const total = SEPARATION_STEPS.length - 1;
  const done = SEPARATION_STEPS.slice(0, -1).filter(s => separationStepStatus(model, s.id) === 'complete').length;
  return { done, total };
}

export function separationNextStepHint(model) {
  const next = SEPARATION_STEPS.find(s => separationStepStatus(model, s.id) !== 'complete');
  return next ? next.label : 'Finish & Export';
}

export function isSeparationPrintFinal(model) {
  return model.status === 'ready' || model.status === 'completed';
}

export function buildSeparationExportName(model) {
  const name = (model.employeeName || 'Employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const date = model.effectiveSeparationDate || todayISO();
  const draftSuffix = isSeparationPrintFinal(model) ? '' : '_DRAFT';
  return `${name}_EmployeeSeparation_${date}${draftSuffix}`;
}
