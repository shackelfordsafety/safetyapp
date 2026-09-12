/* ── The simulator: is it switched on, and what did it make? ─────────────
   Fonzo, 2026-09-12: "setting me up like a simulation branch where i have
   buttons that create a full jsa, i submit and make sure everything is
   clean."

   Filling six documents by hand to test one button is the part worth
   automating. This is that: one tap fills a whole document, and then he
   walks the real flow with real buttons.

   WHERE IT SHOWS UP. Never by accident. Either the testing site (where
   demoMode already refuses every cloud write), or ?sim=1 on any host for
   when he wants to run the real chain against the real database and see
   it land. A superintendent who never types ?sim=1 can never find it.

   WHY THINGS IT MAKES ARE MARKED. A seeded document that reaches HR's
   queue looks exactly like a real separation form -- somebody's name and
   the reason they were let go. Every seeded document is stamped with a
   run code in its own title field, so it reads as SIM on every screen it
   ever appears on, and so the clean-up below can find it again.

   This file is tiny and imported eagerly. Everything with weight -- the
   seed documents, the panel -- is loaded only when the simulator is on.

   Kept OUT of the archive on purpose: filing is append-only by design and
   there is no delete policy, so anything the simulator files stays filed.
   The panel says so rather than pretending otherwise. */

const KEY = 'sdc.sim.run.v1';

export const SIM_ON = (() => {
  try {
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('sim') === '1') return true;
    /* The testing host gets it for free -- that is what the host is for. */
    return /\.workers\.dev$|\.pages\.dev$/i.test(window.location.hostname);
  } catch {
    return false;
  }
})();

/* A short code for this run, so everything made in one sitting shares a
   marker and can be told apart from last week's. Regenerated on demand. */
export function runCode() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const code = `SIM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    localStorage.setItem(KEY, code);
    return code;
  } catch {
    return 'SIM';
  }
}

export function newRunCode() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  return runCode();
}

/* The field that carries the marker on each document type -- whichever one
   is the document's own headline on screen, so it is impossible to miss. */
export const MARKED_FIELD = {
  jsa: 'jobSite',
  incident: 'workplaceLocation',
  disciplinary: 'employeeName',
  separation: 'employeeName',
  medicalEvent: 'employeeName',
  uncontrolledEvent: 'location',
};
