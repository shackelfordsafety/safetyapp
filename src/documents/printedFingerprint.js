/* Generic "printed content changed?" fingerprint — generalizes Incident's
   own printedIncidentFingerprint/NON_PRINTED_INCIDENT_FIELDS pattern for
   the four new documents, which all share the same bookkeeping field
   names (id/status/createdAt/lastSavedAt/completedAt/notes) by convention.
   Used both for the ready/completed -> draft reversion rule
   (useDraftDocument's upd()) and for PDF staleness checks (usePdfExport),
   so both call sites can never drift apart on what counts as "printed
   content". */
/* employeeHandoff: the QR code still waiting on the employee's phone
   (disciplinary/separation/medical). Bookkeeping, never printed -- making,
   cancelling or expiring one must not mark the PDF stale or knock a
   finished document back to draft. Audit 2026-09-30, C3. */
const DEFAULT_EXCLUDE = ['id', 'status', 'createdAt', 'lastSavedAt', 'completedAt', 'notes', 'employeeHandoff'];

export function printedFingerprint(model, extraExclude = []) {
  const printed = { ...model };
  [...DEFAULT_EXCLUDE, ...extraExclude].forEach(k => { delete printed[k]; });
  return JSON.stringify(printed);
}
