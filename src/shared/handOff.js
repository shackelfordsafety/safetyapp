/* ── Handing a document off ──────────────────────────────────────────────
   Fonzo, 2026-09-11, after a clerk kept seeing a separation form he had
   already sent up and kept thinking he still had something to do: "once
   she submits, i don't want Nic seeing it ever again, no draft or
   anything, soon as someone hits submit for review or whatever, it needs
   to disappear... this draft stuff is fucking us."

   He is right, and the bug is conceptual rather than mechanical. A draft
   is YOUR unfinished work. The moment it is submitted for review or
   published to the board it stops being yours -- somebody else owns what
   happens next. Leaving a copy on the device left three versions of one
   separation form in the world (the author's, the server's, and the
   approver's corrected one) and no rule about which was true.

   So submitting is a hand-off: the local draft goes.

   WHAT IS KEPT, and why it is not the draft. "Repeat Last JSA" reads the
   saved draft today, so deleting the draft would silently kill the one
   feature a superintendent uses every single morning. Instead the finished
   document is copied to its own snapshot slot on the way out. Nothing
   reads it as work-in-progress; it only answers "same as last time?" when
   somebody starts a new one.

   Fonzo's words for the shape of that: "once i publish to the board, the
   draft goes away and i have to hit start a new JSA and THAT is where u
   get 'same info as before?' yes or no and it brings back the proper
   info." */

const SNAPSHOT_KEYS = {
  jsa: 'sdc.jsa.lastFinished.v1',
  incident: 'sdc.incident.lastFinished.v1',
  disciplinary: 'sdc.discipline.lastFinished.v1',
  uncontrolledEvent: 'sdc.uncontrolled.lastFinished.v1',
  medicalEvent: 'sdc.medical.lastFinished.v1',
  separation: 'sdc.separation.lastFinished.v1',
};

const DRAFT_KEYS = {
  jsa: 'sdc.jsa.draft.v4',
  incident: 'sdc.incident.draft.v1',
  disciplinary: 'sdc.discipline.draft.v1',
  uncontrolledEvent: 'sdc.uncontrolled.draft.v1',
  medicalEvent: 'sdc.medical.draft.v1',
  separation: 'sdc.separation.draft.v1',
};

/* Written at hand-off so "same as last time" has something to read after
   the draft is gone. Best effort throughout: a snapshot that fails to save
   costs a convenience, and must never stop the document being handed off
   or leave the draft sitting there. */
export function snapshotFinished(docType, model) {
  const key = SNAPSHOT_KEYS[docType];
  if (!key || !model) return false;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), model }));
    return true;
  } catch {
    return false;
  }
}

export function readLastFinished(docType) {
  const key = SNAPSHOT_KEYS[docType];
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.model ? parsed : null;
  } catch {
    return null;
  }
}

/* The hand-off itself. Snapshot first, THEN remove -- in that order, so a
   failure at the wrong moment leaves the draft rather than losing the work
   entirely.

   This only clears storage. The caller must also reset the workflow's own
   React state, or its autosave will write the draft straight back from
   memory a moment later. That is not a theoretical risk: the autosave runs
   on a 900ms debounce and would win. */
export function handOffDraft(docType, model) {
  snapshotFinished(docType, model);
  const key = DRAFT_KEYS[docType];
  if (!key) return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/* Replaces this device's snapshot with one that came from another device.
   Used by sync -- see src/sync/userSync.js.

   Same shape snapshotFinished writes, so everything that reads it
   (readLastFinished, and "Same info as last time?" through it) cannot
   tell the difference between a JSA finished here and one finished on the
   phone this morning. Which is the entire point. */
export function writeLastFinished(docType, snapshot) {
  const key = SNAPSHOT_KEYS[docType];
  if (!key || !snapshot?.model) return false;
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: snapshot.savedAt || new Date().toISOString(),
      model: snapshot.model,
    }));
    return true;
  } catch {
    return false;
  }
}
