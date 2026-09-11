/* ── What actually changed ───────────────────────────────────────────────
   When an approver fixes a typo or rewords something, the man who wrote it
   has to be able to see exactly what moved. Fonzo, 2026-09-11: "so someone
   can't be like 'i never saw that' type shi."

   A whole-document dump would not do that -- it puts the burden on him to
   spot the difference. This produces the specific fields, with the words
   before and the words after.

   Deliberately shallow and boring. It compares the top-level fields of two
   versions of the same model and skips the plumbing. Nested arrays (task
   rows, witnesses, photos) are reported as "changed" without a word-level
   diff: saying WHICH witness statement moved is worth doing later, and
   guessing at it now would produce a confident wrong answer, which is
   worse than "the witnesses were changed". */

/* Never interesting to a human, and several of them move on every save. */
const IGNORED = new Set([
  'id', 'status', 'createdAt', 'lastSavedAt', 'completedAt', 'updatedAt',
  'reportNumber', 'suggestionBundles', 'signatureLineCount', 'signInMode',
  'crewSignatures',
]);

/* Field names read to a person, not to a database. Anything not listed
   falls back to un-camel-casing the key, which is usually fine
   ("workplaceLocation" -> "Workplace location"). */
const LABELS = {
  workplaceLocation: 'Workplace location',
  incidentDate: 'Date of incident',
  incidentTime: 'Time of incident',
  exactLocation: 'Exact location',
  incidentDescription: 'What happened',
  injuredPartyName: 'Injured party',
  natureOfInjury: 'Nature of injury',
  bodyParts: 'Body parts affected',
  treatmentLevel: 'Treatment level',
  propertyDamaged: 'Property damaged',
  correctiveActions: 'Corrective actions',
  rootCause: 'Root cause',
  employeeName: 'Employee',
  jobSite: 'Job site',
  projectLocation: 'Project location',
  eventDate: 'Date of event',
  noticeDate: 'Date of notice',
  lastDayWorked: 'Last day worked',
  supervisorNotes: 'Supervisor notes',
};

function label(key) {
  if (LABELS[key]) return LABELS[key];
  const spaced = String(key).replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
    || (Array.isArray(v) && v.length === 0);
}

/* Trimmed for display. A change is worth showing in full up to a point;
   past that a man is reading a wall, not a diff. */
function show(v) {
  if (isEmpty(v)) return '(blank)';
  if (Array.isArray(v)) return v.length === 1 ? '1 entry' : `${v.length} entries`;
  if (typeof v === 'object') return 'changed';
  const s = String(v);
  return s.length > 180 ? `${s.slice(0, 177)}…` : s;
}

export function diffDocuments(before, after) {
  const a = before || {};
  const b = after || {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const out = [];

  keys.forEach((key) => {
    if (IGNORED.has(key)) return;
    const was = a[key];
    const now = b[key];

    if (Array.isArray(was) || Array.isArray(now) || (was && typeof was === 'object') || (now && typeof now === 'object')) {
      // Structured content: say it moved, don't pretend to know how.
      if (JSON.stringify(was ?? null) !== JSON.stringify(now ?? null)) {
        out.push({ field: key, label: label(key), before: show(was), after: show(now) });
      }
      return;
    }

    const wasS = isEmpty(was) ? '' : String(was);
    const nowS = isEmpty(now) ? '' : String(now);
    if (wasS === nowS) return;
    out.push({ field: key, label: label(key), before: show(was), after: show(now) });
  });

  return out;
}

/* One line for a list, so the author sees what happened before he opens
   anything. */
export function summarizeChanges(changes) {
  const list = changes || [];
  if (!list.length) return 'No wording was changed.';
  if (list.length === 1) return `Changed ${list[0].label.toLowerCase()}.`;
  if (list.length === 2) return `Changed ${list[0].label.toLowerCase()} and ${list[1].label.toLowerCase()}.`;
  return `Changed ${list[0].label.toLowerCase()}, ${list[1].label.toLowerCase()} and ${list.length - 2} more.`;
}
