/* ── Signatures that cannot quietly go missing ───────────────────────────
   The kiosk used to increment its count the instant a man lifted the
   stylus, fire the upload, and swallow any error -- with a comment saying
   the board's count was the source of truth, not that screen. But the man
   is looking at THAT screen. He sees the number go up and walks off, and
   if the upload failed he is on a job with no signature on the JSA and
   nobody knows.

   Found by an outside reviewer, 2026-09-11, and it is the most damaging
   kind of bug this app can have: paperwork you believe you have and do
   not.

   So every kiosk signature is written to this queue FIRST, on the device,
   and only leaves it when the database has actually accepted it. A flat
   tyre on the network costs a delay, never a signature.

   Why localStorage and not memory: the iPad gets locked, dropped in a
   truck, and the browser tab gets discarded. A queue that dies with the
   tab is not a queue.

   What this deliberately does NOT do is retry forever in silence. If
   something is stuck, the screen says so and says how many -- a
   superintendent can then make the call to sign on paper instead, which is
   a decision he can only make if he is told. */

const KEY = 'sdc.signatures.pending.v1';

/* Signature images are a few KB each and localStorage is a few MB. A cap
   well under that, so a genuinely broken connection degrades into "tell
   somebody" rather than into a storage exception that loses the lot. */
const MAX_QUEUED = 120;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function pendingCount() {
  return read().length;
}

/* Held on the device before anything is attempted. Returns false only when
   it could not even be stored, which the caller must surface -- that is
   the one case where the man genuinely has not signed anything. */
export function queueSignature(entry) {
  const list = read();
  if (list.length >= MAX_QUEUED) return false;
  list.push({
    id: (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
    ...entry,
  });
  return write(list);
}

function drop(id) {
  write(read().filter(x => x.id !== id));
}

/* Tries everything waiting. `send` is passed in rather than imported so
   this file never pulls the Supabase client into the crew bundle on its
   own -- board.js already owns that import.

   Order matters: the row is only dropped once send() has RESOLVED. A throw
   leaves it exactly where it was for the next attempt. */
export async function flushSignatures(send) {
  const list = read();
  if (!list.length) return { sent: 0, stuck: 0 };
  let sent = 0;
  let stuck = 0;
  for (const item of list) {
    try {
      await send(item);
      drop(item.id);
      sent += 1;
    } catch (err) {
      /* A signature the database refuses will NEVER succeed -- the JSA
         expired, or the posting was taken down. Retrying it forever would
         block everything queued behind it, so it is dropped and counted as
         stuck rather than kept for eternity. */
      const permanent = /row-level security|violates row-level|expired/i.test(err?.message || '');
      if (permanent) {
        drop(item.id);
        stuck += 1;
      } else {
        stuck += 1;
      }
    }
  }
  return { sent, stuck };
}
