/* ── Signing out takes your paperwork with you ───────────────────────────
   Fonzo, 2026-09-11, after HR signed out on a shared device and her
   half-written separation form was still sitting there for whoever picked
   it up next: "once you sign out, any drafts or ongoing paperwork that
   you're working on disappears. That way nobody can go back and see what
   you were trying to do."

   He is right and it is the obvious hole. A separation form names an
   employee and says why they are being let go. A disciplinary notice is
   worse. These live in localStorage, which is per-device and not per
   person, so on the one iPad in a job trailer "signed out" meant nothing
   at all.

   WHAT GETS CLEARED: the six document drafts, the picked-up link, and the
   last-finished snapshots -- everything that holds the CONTENT of somebody's
   work.

   WHAT DOES NOT: templates, favourites, recent quick-adds, theme. Those are
   the device's setup, not a person's paperwork, and wiping a
   superintendent's templates because somebody signed out would be its own
   kind of damage. */

const CONTENT_KEYS = [
  'sdc.jsa.draft.v4',
  'sdc.incident.draft.v1',
  'sdc.discipline.draft.v1',
  'sdc.uncontrolled.draft.v1',
  'sdc.medical.draft.v1',
  'sdc.separation.draft.v1',
  // Where a picked-up document came from, and a copy of its original.
  'sdc.open.pickedUp.v1',
  // "Same info as last time?" snapshots -- these are whole finished
  // documents, so they are content too.
  'sdc.jsa.lastFinished.v1',
  'sdc.incident.lastFinished.v1',
  'sdc.discipline.lastFinished.v1',
  'sdc.uncontrolled.lastFinished.v1',
  'sdc.medical.lastFinished.v1',
  'sdc.separation.lastFinished.v1',
];

const LABELS = {
  'sdc.jsa.draft.v4': 'a JSA',
  'sdc.incident.draft.v1': 'an incident report',
  'sdc.discipline.draft.v1': 'a disciplinary notice',
  'sdc.uncontrolled.draft.v1': 'an uncontrolled event report',
  'sdc.medical.draft.v1': 'a medical event form',
  'sdc.separation.draft.v1': 'a separation form',
};

/* What is actually on this device right now, in words, so somebody can be
   told what they are about to lose rather than warned in the abstract. */
export function unfinishedOnThisDevice() {
  const found = [];
  Object.keys(LABELS).forEach((key) => {
    try {
      if (localStorage.getItem(key)) found.push(LABELS[key]);
    } catch {
      /* Storage unreadable -- nothing to warn about and nothing to clear. */
    }
  });
  return found;
}

/* Once the wipe has run, nothing may write a draft back.

   Signing out clears storage and then reloads the page, and a reload fires
   the same browser events ("this page is going away") that tell the
   autosave system to write down anything it was still holding. Without
   this flag, signing out would wipe the separation form and then put it
   straight back -- exactly the hole this file exists to close. The forms
   hold that work in memory, so clearing storage alone is never enough.

   Not reset anywhere: the page is on its way to reloading, and after the
   reload this is a fresh module with the flag back to false. */
let wiped = false;
export function workWasClearedForSignOut() {
  return wiped;
}

export function clearWorkFromThisDevice() {
  wiped = true;
  /* Photos attached to an incident report live in IndexedDB, keyed by the
     report's id -- which is INSIDE the draft. So the id has to be read
     before the draft is removed, or the photos are orphaned in the browser
     forever with no way left to find them. A photo of an injury is at
     least as personal as the report it belongs to. */
  let incidentId = null;
  try {
    const raw = localStorage.getItem('sdc.incident.draft.v1');
    if (raw) incidentId = JSON.parse(raw)?.id || null;
  } catch { /* unreadable draft: nothing to key the photos by */ }

  CONTENT_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch { /* best effort, per key */ }
  });

  /* Not awaited. A photo left behind is bad; a sign-out that hangs on a
     database call and leaves somebody apparently still signed in is worse. */
  if (incidentId) {
    import('../incident/incidentPhotoStorage')
      .then(m => m.deletePhotosForIncident(incidentId))
      .catch(() => { /* nothing to clean, or storage refused */ });
  }
}
