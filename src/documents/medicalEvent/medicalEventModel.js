/* ── Employee Medical Event data model ──
   Field-for-field from the company Employee Medical Event form. This form
   documents an employee-reported medical condition/event WITHOUT the app
   ever automatically declaring it occupational — see the mission brief's
   explicit design rule: distinguish WHAT THE EMPLOYEE REPORTED from WHAT
   SAFETY/SUPERVISION OBSERVED, never infer causation, never determine OSHA
   recordability. Field names below reflect that split
   (reportedSymptoms/symptomsOnset/specificWorkEventReported are employee-
   reported; safetyObservations is what safety/supervision actually saw and
   did) so the distinction is structural, not just a UI label. */

export const MEDICAL_EVENT_SCHEMA_VERSION = 1;

function makeId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowHM() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const SYMPTOM_ONSET_OPTIONS = [
  { value: 'beforeWork', label: 'Before Work' },
  { value: 'duringWork', label: 'During Work' },
  { value: 'unknown', label: 'Unknown' },
];

export const RESPONSE_ACTIONS = [
  'Water / Electrolytes Offered',
  'Rest Period',
  'First Aid',
  'EMS Contacted',
  'Medical Evaluation Recommended',
  'Transport Provided',
  'Other',
];

export const MEDICAL_EVALUATION_TYPES = [
  { value: 'notRequested', label: 'Not Requested' },
  { value: 'personalVisit', label: 'Personal Medical Visit' },
  { value: 'emsER', label: 'EMS / Emergency Room' },
  { value: 'other', label: 'Other' },
];

export const WORK_STATUS_OPTIONS = [
  { value: 'fullDuty', label: 'Full Duty' },
  { value: 'restrictedDuty', label: 'Restricted Duty' },
  { value: 'offWork', label: 'Off Work Until' },
  { value: 'pending', label: 'Pending' },
];

export const INITIAL_CLASSIFICATIONS = [
  { value: 'nonOccupational', label: 'Non-Occupational Medical Event' },
  { value: 'workRelated', label: 'Work-Related / Incident Report Required' },
  { value: 'pendingReview', label: 'Pending Review' },
];

export const MEDICAL_ATTACHMENT_OPTIONS = ['Photos', 'Video', 'Other'];

export function emptyMedicalEvent() {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    schemaVersion: MEDICAL_EVENT_SCHEMA_VERSION,
    status: 'draft', // 'draft' | 'ready' | 'completed'
    createdAt: now,
    lastSavedAt: '',
    completedAt: '',

    // Employee Information
    employeeName: '',
    supervisor: '',
    position: '',
    projectLocation: '',
    eventDate: todayISO(),
    timeReported: nowHM(),

    // Employee-Reported Condition
    reportedSymptoms: '',
    symptomsOnset: '', // '' | 'beforeWork' | 'duringWork' | 'unknown'
    specificWorkEventReported: '', // '' | 'yes' | 'no'
    workEventDescription: '',

    // Response / Actions Taken
    responseActions: [],
    responseActionsOther: '',
    safetyObservations: '', // what safety/supervision observed and did — never merged with employee-reported fields

    // Medical Evaluation / Work Status
    medicalEvaluationType: '', // '' | 'notRequested' | 'personalVisit' | 'emsER' | 'other'
    medicalEvaluationOther: '',
    clinicProvider: '',
    workStatus: '', // '' | 'fullDuty' | 'restrictedDuty' | 'offWork' | 'pending'
    // The paper form dates BOTH return-to-work outcomes: "Full Duty on: ___"
    // and "Off Work Until: ___".
    fullDutyOnDate: '',
    offWorkUntilDate: '',
    providerNoteAttached: false,

    // Attachments
    attachments: [],
    attachmentOther: '',

    // Initial Classification (never auto-set by the app)
    initialClassification: '', // '' | 'nonOccupational' | 'workRelated' | 'pendingReview'

    // Signatures. The paper form prints a NAME line above each signature.
    // Left blank these fall back to the employee/supervisor named up top, so
    // the printed form is never missing a name — but they stay editable,
    // because the person who signs for Safety is not always the supervisor
    // recorded in the employee information block.
    employeeSignatureName: '',
    employeeSignatureData: null, // employee may not always be able to sign
    employeeSignatureDate: '',
    supervisorSignatureName: '',
    supervisorSignatureData: null,
    supervisorSignatureDate: '',

    notes: '',
  };
}

// Every real user-entered field, not just a handful -- this drives the
// unsaved-changes guard on Start Blank/Start New, so a gap here means real
// field data can be silently wiped with no warning. Excludes eventDate/
// timeReported (default to today/now, never empty) and internal-only `notes`.
export function hasMeaningfulMedicalEventContent(model) {
  if (!model) return false;
  return [
    model.employeeName, model.supervisor, model.position, model.projectLocation,
    model.reportedSymptoms, model.workEventDescription, model.responseActionsOther,
    model.safetyObservations, model.medicalEvaluationOther, model.clinicProvider,
    model.fullDutyOnDate, model.offWorkUntilDate, model.attachmentOther,
    model.employeeSignatureName, model.supervisorSignatureName,
  ].some(v => String(v || '').trim().length > 0)
    || Boolean(model.symptomsOnset) || Boolean(model.specificWorkEventReported)
    || Boolean(model.initialClassification) || Boolean(model.medicalEvaluationType)
    || Boolean(model.workStatus) || Boolean(model.providerNoteAttached)
    || (model.responseActions || []).length > 0
    || (model.attachments || []).length > 0
    || Boolean(model.employeeSignatureData) || Boolean(model.supervisorSignatureData);
}

// Content -> Review -> Signatures -> Export, no exceptions (Fonzo, standing
// rule, 2026-08-20).
export const MEDICAL_EVENT_STEPS = [
  { id: 'condition', label: 'Event & Response', helper: 'Employee info, reported condition, and response taken' },
  { id: 'evaluation', label: 'Evaluation & Classification', helper: 'Medical evaluation, work status, and attachments' },
  { id: 'review', label: 'Review', helper: 'Check everything before anyone signs' },
  { id: 'signatures', label: 'Signature', helper: 'Safety/Supervisor signs (employee may sign too, if able)' },
  { id: 'export', label: 'Finish & Export', helper: 'Save, generate, and download the PDF' },
];

export function getMedicalEventReadinessChecks(model) {
  const has = v => String(v || '').trim().length > 0;
  const checks = [
    { key: 'employeeName', label: 'Employee name', ok: has(model.employeeName), step: 'condition' },
    { key: 'supervisor', label: 'Supervisor', ok: has(model.supervisor), step: 'condition' },
    { key: 'eventDate', label: 'Date', ok: has(model.eventDate), step: 'condition' },
    { key: 'reportedSymptoms', label: 'Employee-reported symptoms / concerns', ok: has(model.reportedSymptoms), step: 'condition' },
    { key: 'symptomsOnset', label: 'When symptoms first appeared', ok: has(model.symptomsOnset), step: 'condition' },
    { key: 'specificWorkEventReported', label: 'Specific work event/exposure question answered', ok: has(model.specificWorkEventReported), step: 'condition' },
    { key: 'initialClassification', label: 'Initial classification selected', ok: has(model.initialClassification), step: 'evaluation' },
    // Employee signature stays optional ("if able") -- the app never asks
    // the employee to sign. Only the Safety/Supervisor signature is required.
    { key: 'supervisorSignature', label: 'Safety / Supervisor signature', ok: Boolean(model.supervisorSignatureData), step: 'signatures' },
  ];
  if (model.specificWorkEventReported === 'yes') {
    checks.push({ key: 'workEventDescription', label: 'Work event/exposure description', ok: has(model.workEventDescription), step: 'condition' });
  }
  if (model.workStatus === 'offWork') {
    checks.push({ key: 'offWorkUntilDate', label: '"Off Work Until" date', ok: has(model.offWorkUntilDate), step: 'evaluation' });
  }
  return checks;
}

export function isMedicalEventReady(model) {
  return getMedicalEventReadinessChecks(model).every(c => c.ok);
}

// Derived directly from getMedicalEventReadinessChecks (each check already
// carries the step it belongs to) rather than a second, separately
// hand-picked field list -- the two had drifted (e.g. this considered
// "evaluation" complete without checking the conditionally-required
// offWorkUntilDate when work status is "Off Work"). 'export' is the
// terminal step -- see disciplinaryStepStatus for why it (not 'review',
// which now comes before Signatures) reflects the whole document's readiness.
export function medicalEventStepStatus(model, stepId) {
  if (stepId === 'export') return isMedicalEventReady(model) ? 'complete' : 'needs-info';
  const relevant = getMedicalEventReadinessChecks(model).filter(c => c.step === stepId);
  if (!relevant.length) return 'complete';
  return relevant.every(c => c.ok) ? 'complete' : 'needs-info';
}

export function medicalEventStepProgress(model) {
  const total = MEDICAL_EVENT_STEPS.length - 1;
  const done = MEDICAL_EVENT_STEPS.slice(0, -1).filter(s => medicalEventStepStatus(model, s.id) === 'complete').length;
  return { done, total };
}

export function medicalEventNextStepHint(model) {
  const next = MEDICAL_EVENT_STEPS.find(s => medicalEventStepStatus(model, s.id) !== 'complete');
  return next ? next.label : 'Finish & Export';
}

export function isMedicalEventPrintFinal(model) {
  return model.status === 'ready' || model.status === 'completed';
}

export function buildMedicalEventExportName(model) {
  const name = (model.employeeName || 'Employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const date = model.eventDate || todayISO();
  const draftSuffix = isMedicalEventPrintFinal(model) ? '' : '_DRAFT';
  return `${name}_MedicalEvent_${date}${draftSuffix}`;
}
