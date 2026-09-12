/* ── Am I signed in? Answered without loading anything ───────────────────
   supabase-js v2 keeps its session in localStorage under
   sb-<project ref>-auth-token. Reading it directly means the app can know
   who you are without pulling in 59 kB of auth library on a cold start --
   which would drag cloud code into the bundle every superintendent
   downloads and break the offline-first promise this app is built on.

   It also means the answer is correct with no signal, instantly, which
   matters because the first thing several screens do is decide whether to
   even try the network.

   Matched by shape rather than a hardcoded project ref, so pointing this
   app at a different Supabase project doesn't silently break it.

   This was AccountButton's private helper until template sync needed the
   same answer. One copy, so the two can never disagree about whether
   somebody is signed in. */

export function readStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      const user = parsed?.user || parsed?.currentSession?.user;
      if (user?.email) return { email: user.email, id: user.id || null };
    }
  } catch { /* private mode, or a shape we don't recognise -- treat as guest */ }
  return null;
}

/* A stable-ish name for this device, so a sync conflict can say "your
   iPhone" instead of "another device". Generated once and kept locally;
   it never leaves this browser except as a label on the sync row. */
const DEVICE_KEY = 'sdc.deviceName.v1';

export function deviceName() {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const ua = navigator.userAgent || '';
    let guess = 'this device';
    if (/iPhone/i.test(ua)) guess = 'iPhone';
    else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) guess = 'iPad';
    else if (/Android/i.test(ua)) guess = 'Android phone';
    else if (/Mac/i.test(ua)) guess = 'Mac';
    else if (/Windows/i.test(ua)) guess = 'Windows PC';
    localStorage.setItem(DEVICE_KEY, guess);
    return guess;
  } catch {
    return 'this device';
  }
}

/* ── Telling the rest of the app that who-you-are just changed ────────────
   The account chip in the corner showed "Guest — Sign in" to somebody who
   had just signed in on the Records screen and was looking at role-gated
   data. It listened for `storage` and `focus`, and neither ever fires for
   this: a `storage` event only reaches OTHER tabs, never the one that made
   the change, and focus does not move when you sign in on a screen you are
   already looking at. So the chip sat there calling a signed-in
   superintendent a guest until something else happened to wake it.

   Found while screenshotting the review flow, 2026-09-12.

   A plain event rather than a Supabase subscription, deliberately:
   anything that changes the session can announce it without importing the
   auth library, which is what keeps that library out of the bundle a
   superintendent downloads. */
const SESSION_EVENT = 'sdc:session-changed';

export function notifySessionChanged() {
  try { window.dispatchEvent(new Event(SESSION_EVENT)); } catch { /* no window */ }
}

/* Returns its own cleanup, so a caller can hand it straight to useEffect. */
export function onSessionChanged(handler) {
  window.addEventListener(SESSION_EVENT, handler);
  /* Kept alongside the new event: `storage` is still the right signal for a
     second tab, and focus still catches a sign-in that happened elsewhere
     entirely. */
  window.addEventListener('storage', handler);
  window.addEventListener('focus', handler);
  return () => {
    window.removeEventListener(SESSION_EVENT, handler);
    window.removeEventListener('storage', handler);
    window.removeEventListener('focus', handler);
  };
}
