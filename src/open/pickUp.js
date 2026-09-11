/* ── Opening a shared document in the real workflow ──────────────────────
   The piece everything else was waiting on. A document in the review queue
   was readable as a row and nothing more: the approver could sign it off
   or send it back, but could not open it, read it properly, or fix a word.

   Two things need exactly this and neither could be built without it:

     An approver editing wording. Fonzo, 2026-09-11: "an approver can open
     it and fix a typo or some wording themselves, that's okay but the
     sender has to receive some type of notification that something was
     changed." The notification half is built; this is the opening half.

     Regenerating a clean PDF at sign-off. Every printout an author makes
     now carries a DRAFT stamp, on purpose -- a super must not be able to
     produce an official-looking report on his own. But the APPROVED copy
     in the archive must not say DRAFT, and the only way to make a clean
     one is to have the document loaded in the workflow that draws it.

   HOW IT WORKS, and why it is not more clever than this: it writes the
   document into the same localStorage draft slot the workflow already
   reads, and lets the workflow do what it always does. No second code
   path, no "review mode" version of six forms. The workflow does not need
   to know the document came from somewhere else.

   WHAT IT DELIBERATELY DOES NOT DO: overwrite whatever the man is already
   working on. That is the caller's decision and it goes through the same
   confirmation the app already uses for replacing a draft. */

/* The slot each document type already lives in. Kept here rather than
   imported from four different storage modules, because three of them are
   lazily loaded and this has to be callable before any workflow is open.
   If one of these ever changes, it changes in two places -- which is why
   the constant below exists to fail loudly rather than quietly write to a
   slot nothing reads. */
const DRAFT_KEYS = {
  jsa: 'sdc.jsa.draft.v4',
  incident: 'sdc.incident.draft.v1',
  disciplinary: 'sdc.discipline.draft.v1',
  uncontrolledEvent: 'sdc.uncontrolled.draft.v1',
  medicalEvent: 'sdc.medical.draft.v1',
  separation: 'sdc.separation.draft.v1',
};

/* Which open document the local draft currently came from, so saving goes
   back to the right row instead of creating a second one. Survives a
   reload, because a man picks something up and then his iPad sleeps. */
const LINK_KEY = 'sdc.open.pickedUp.v1';

export function draftKeyFor(docType) {
  return DRAFT_KEYS[docType] || null;
}

export function readPickedUpLink() {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.openDocumentId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPickedUpLink() {
  try { localStorage.removeItem(LINK_KEY); } catch { /* nothing to undo */ }
}

/* Writes the document into its workflow's slot and records where it came
   from. Returns the doc type so the caller knows which workflow to open.

   Throws rather than half-succeeding: a document written into a slot
   nothing reads would look like it vanished. */
export function placeIntoWorkflow(row) {
  const key = draftKeyFor(row?.doc_type);
  if (!key) throw new Error(`No workflow on this device handles a "${row?.doc_type}" document.`);
  if (!row?.data || typeof row.data !== 'object') {
    throw new Error('That document has no content to open.');
  }

  /* Status is forced back to editable. A document that was marked complete
     under the old behaviour would otherwise open locked, and the whole
     point of picking it up is to change something. */
  const model = { ...row.data, status: 'draft', lastSavedAt: new Date().toISOString() };

  try {
    localStorage.setItem(key, JSON.stringify(model));
    localStorage.setItem(LINK_KEY, JSON.stringify({
      openDocumentId: row.id,
      docType: row.doc_type,
      pickedUpAt: new Date().toISOString(),
      /* Kept so a save can tell what the approver actually changed without
         going back to the network for the original. */
      original: row.data,
    }));
  } catch {
    throw new Error('There is no room left on this device to open it. Free up space and try again.');
  }

  return { docType: row.doc_type, draftKey: key };
}
