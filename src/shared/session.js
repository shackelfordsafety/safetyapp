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
