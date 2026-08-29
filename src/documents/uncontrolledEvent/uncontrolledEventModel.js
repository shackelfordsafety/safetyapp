/* ── Uncontrolled Event Report data model ──
   Field-for-field from the company Uncontrolled Event Report form: event
   information, classification, outcome/impact, a narrative, notifications/
   attachments, witnesses, and Reported By / Supervisor Review signatures.
   Lighter/faster than the full Incident Report by design — see the mission
   brief's own framing ("This should feel lighter/faster than the full
   Incident Report"). Mirrors incidentModel.js's separation of concerns:
   data shape only, no storage/React/PDF code here. */

export const UNCONTROLLED_EVENT_SCHEMA_VERSION = 1;

function makeId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function localDateTimeNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Labels are the paper form's, parentheticals included. Those parentheticals
   are decision aids, not decoration: "(no damage/injury)" is what defines a
   Near Miss, and "(record separately)" is what tells a superintendent an
   injury still needs its own record. Four of them had been dropped while the
   others were kept — see the 2026-08-12 source-fidelity audit.

   These strings are also the stored values in a saved draft, so renaming one
   orphans an existing selection. migrateUncontrolledEventShape() below
   rewrites old drafts; do not rename an option without adding it there. */
export const EVENT_CLASSIFICATIONS = [
  'Weather / Natural (wind, lightning, flood, heat/cold)',
  'Utility / Power / Communications',
  'Third-Party Traffic / Public / Delivery',
  'Equipment / Mechanical Failure (not misuse)',
  'Site Condition Change (ground, erosion, collapse)',
  'Medical Event / Illness (non-occupational)',
  'Wildlife / Environmental',
  'Other',
];

/* The one outcome the app reacts to — it raises the cross-report reminder in
   UncontrolledEventWorkflow. Named, because a workflow that matched the
   display string directly would silently stop reminding anyone the next time
   the label is reworded. */
export const OUTCOME_INJURY = 'Injury / Illness (record separately)';

export const EVENT_OUTCOMES = [
  'Near Miss (no damage/injury)',
  'Operational Delay / Shutdown',
  'Property Damage',
  'Environmental Release / Spill',
  OUTCOME_INJURY,
  'Security / Trespass',
  'Other',
];

/* Options renamed on 2026-08-12 to restore the source form's parentheticals,
   old stored value -> current one. */
const RENAMED_OPTIONS = {
  'Weather / Natural': 'Weather / Natural (wind, lightning, flood, heat/cold)',
  'Site Condition Change': 'Site Condition Change (ground, erosion, collapse)',
  'Near Miss': 'Near Miss (no damage/injury)',
  'Injury / Illness': 'Injury / Illness (record separately)',
};

/* A saved draft stores the option LABEL, so restoring the parentheticals
   would silently untick a selection made before that change — the checkbox
   would print empty and the superintendent's answer would be gone. Rewriting
   on load keeps those answers. Idempotent: a current-shape draft's values
   aren't in the map and pass through untouched. */
export function migrateUncontrolledEventShape(raw) {
  if (!raw) return raw;
  const rename = list => (Array.isArray(list) ? list.map(v => RENAMED_OPTIONS[v] || v) : list);
  return {
    ...raw,
    eventClassifications: rename(raw.eventClassifications),
    eventOutcomes: rename(raw.eventOutcomes),
  };
}

export const NOTIFICATION_OPTIONS = [
  'Supervisor',
  'Safety',
  'Client / GC',
  'EMS',
  'Utility Provider',
  'Environmental',
];

export const ATTACHMENT_OPTIONS = [
  'Photos',
  'Video',
  'Weather Report',
  'Maintenance Records',
  'Other',
];

export function emptyUncontrolledEvent() {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    schemaVersion: UNCONTROLLED_EVENT_SCHEMA_VERSION,
    status: 'draft', // 'draft' | 'ready' | 'completed'
    createdAt: now,
    lastSavedAt: '',
    completedAt: '',

    // Event Information
    workplaceLocation: '',
    eventDate: todayISO(),
    weatherConditions: '',
    reportWrittenDateTime: localDateTimeNow(),
    reportedToSupervisorDateTime: '',

    // Event Classification (check all that apply)
    eventClassifications: [],
    eventClassificationOther: '',

    // Outcome / Impact (check all that apply)
    eventOutcomes: [],
    eventOutcomeOther: '',
    estimatedCost: '',

    // Narrative
    whatHappened: '',
    immediateActionsTaken: '',

    // Notifications / Attachments (check all that apply)
    notifications: [],
    attachments: [],
    attachmentOther: '',
    witnesses: '', // free text — names, one per line

    // Reported By and Supervisor Review are both staff roles (whoever's
    // filing/reviewing this, not the employee) -- both always digitized,
    // no paper option needed.
    reportedByName: '',
    reportedByTitle: '',
    reportedBySignatureData: null,
    reportedBySignatureDate: '',

    // Supervisor Review
    supervisorReviewName: '',
    supervisorSignatureData: null,
    supervisorSignatureDate: '',

    notes: '',
  };
}

// Every real user-entered field, not just a handful -- this drives the
// unsaved-changes guard on Start Blank/Start New, so a gap here means real
// field data can be silently wiped with no warning. Excludes eventDate/
// reportWrittenDateTime (default to today/now, never empty) and internal-only
// `notes`.
export function hasMeaningfulUncontrolledEventContent(model) {
  if (!model) return false;
  return [
    model.workplaceLocation, model.weatherConditions, model.reportedToSupervisorDateTime,
    model.eventClassificationOther, model.eventOutcomeOther, model.estimatedCost,
    model.whatHappened, model.immediateActionsTaken, model.attachmentOther, model.witnesses,
    model.reportedByName, model.reportedByTitle, model.supervisorReviewName,
  ].some(v => String(v || '').trim().length > 0)
    || (model.eventClassifications || []).length > 0
    || (model.eventOutcomes || []).length > 0
    || (model.notifications || []).length > 0
    || (model.attachments || []).length > 0
    || Boolean(model.reportedBySignatureData) || Boolean(model.supervisorSignatureData);
}

// Content -> Review -> Signatures -> Export, no exceptions (Fonzo, standing
// rule, 2026-08-20).
export const UNCONTROLLED_EVENT_STEPS = [
  { id: 'event', label: 'Event Info & Classification', helper: 'Where/when it happened, classification, and outcome' },
  { id: 'narrative', label: 'Narrative & Notifications', helper: 'What happened, and who was notified' },
  { id: 'review', label: 'Review', helper: 'Check everything before anyone signs' },
  { id: 'signatures', label: 'Signatures', helper: 'Reported By and Supervisor Review sign' },
  { id: 'export', label: 'Finish & Export', helper: 'Save, generate, and download the PDF' },
];

export function getUncontrolledEventReadinessChecks(model) {
  const has = v => String(v || '').trim().length > 0;
  const checks = [
    { key: 'workplaceLocation', label: 'Workplace location / project', ok: has(model.workplaceLocation), step: 'event' },
    { key: 'eventDate', label: 'Date of event', ok: has(model.eventDate), step: 'event' },
    { key: 'eventClassifications', label: 'At least one event classification selected', ok: (model.eventClassifications || []).length > 0, step: 'event' },
    { key: 'eventOutcomes', label: 'At least one outcome/impact selected', ok: (model.eventOutcomes || []).length > 0, step: 'event' },
    { key: 'whatHappened', label: 'What happened / summary', ok: has(model.whatHappened), step: 'narrative' },
    { key: 'reportedByName', label: 'Reported by name', ok: has(model.reportedByName), step: 'narrative' },
    // Supervisor Review signature stays optional -- only Reported By is required.
    { key: 'reportedBySignature', label: 'Reported by signature', ok: Boolean(model.reportedBySignatureData), step: 'signatures' },
  ];
  if ((model.eventClassifications || []).includes('Other')) {
    checks.push({ key: 'eventClassificationOther', label: 'Other classification (specify)', ok: has(model.eventClassificationOther), step: 'event' });
  }
  if ((model.eventOutcomes || []).includes('Other')) {
    checks.push({ key: 'eventOutcomeOther', label: 'Other outcome (specify)', ok: has(model.eventOutcomeOther), step: 'event' });
  }
  return checks;
}

export function isUncontrolledEventReady(model) {
  return getUncontrolledEventReadinessChecks(model).every(c => c.ok);
}

// Derived directly from getUncontrolledEventReadinessChecks (each check
// already carries the step it belongs to) rather than a second, separately
// hand-picked field list -- the two had drifted (e.g. this considered
// "event" complete without checking the conditionally-required "Other"
// specify fields for classification/outcome). 'export' is the terminal step
// -- see disciplinaryStepStatus for why it (not 'review', which now comes
// before Signatures) reflects the whole document's readiness.
export function uncontrolledEventStepStatus(model, stepId) {
  if (stepId === 'export') return isUncontrolledEventReady(model) ? 'complete' : 'needs-info';
  const relevant = getUncontrolledEventReadinessChecks(model).filter(c => c.step === stepId);
  if (!relevant.length) return 'complete';
  return relevant.every(c => c.ok) ? 'complete' : 'needs-info';
}

export function uncontrolledEventStepProgress(model) {
  const total = UNCONTROLLED_EVENT_STEPS.length - 1;
  const done = UNCONTROLLED_EVENT_STEPS.slice(0, -1).filter(s => uncontrolledEventStepStatus(model, s.id) === 'complete').length;
  return { done, total };
}

export function uncontrolledEventNextStepHint(model) {
  const next = UNCONTROLLED_EVENT_STEPS.find(s => uncontrolledEventStepStatus(model, s.id) !== 'complete');
  return next ? next.label : 'Finish & Export';
}

export function isUncontrolledEventPrintFinal(model) {
  return model.status === 'ready' || model.status === 'completed';
}

export function buildUncontrolledEventExportName(model) {
  const site = (model.workplaceLocation || 'Site').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const date = model.eventDate || todayISO();
  const draftSuffix = isUncontrolledEventPrintFinal(model) ? '' : '_DRAFT';
  return `${site}_UncontrolledEventReport_${date}${draftSuffix}`;
}
