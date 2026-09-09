/* ── Making a phone number look like a phone number ──────────────────────
   Supers type these into a free-text box at 5am, so what comes out is
   whatever they felt like: "6626102036", "601-555-0142", "(601) 555 0142",
   "911". Printed back exactly as typed, a bare ten-digit run is genuinely
   hard to read off a page or a phone screen -- which is the one moment it
   matters.

   So this is display only. The value the user typed is what stays stored
   and what gets dialled; this just decides how it reads.

   Deliberately conservative. It reformats ONLY when the text is nothing
   but digits and punctuation AND the digit count is a shape it actually
   recognises. Anything else -- an extension, two numbers in one field, a
   note like "cell", a number from outside North America -- comes back
   exactly as typed, because a formatter that rearranges something it
   misread is worse than one that leaves it alone. */

const NANP_10 = 10;
const NANP_11 = 11; // leading country code
const LOCAL_7 = 7;

export function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function formatPhone(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  // Any letter at all means there is something here we don't understand
  // (an extension, a name, a note) -- leave it exactly as written.
  if (/[a-z]/i.test(text)) return text;

  const d = phoneDigits(text);
  if (d.length === NANP_10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === NANP_11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === LOCAL_7) return `${d.slice(0, 3)}-${d.slice(3)}`;

  // 911, and anything else we don't recognise.
  return text;
}

/* Whether a field holds ONE number a phone could actually dial.

   Three digits counts, and is the important case: real JSAs carry "911" on
   its own in the emergency field, and that is the one number on the page
   that has to be a single tap.

   A field holding two numbers ("911 / 601-555-0199") deliberately does not
   qualify -- stripping the punctuation out of that gives thirteen digits of
   nonsense, and a tap-to-call that dials nonsense in an emergency is worse
   than no link at all. */
const DIALABLE_LENGTHS = [3, LOCAL_7, NANP_10, NANP_11];

export function isDialable(value) {
  if (/[a-z]/i.test(String(value || ''))) return false;
  return DIALABLE_LENGTHS.includes(phoneDigits(value).length);
}
