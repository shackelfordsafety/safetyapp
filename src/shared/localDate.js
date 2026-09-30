/* The device's own calendar day as YYYY-MM-DD.

   Every form used to default its date to
   `new Date().toISOString().slice(0, 10)`, which is the UTC day, not the
   day on the wall. In Central time that flips to tomorrow at 7pm (6pm in
   winter), so a write-up done at the end of a shift, a night-shift JSA
   and every signature stamped in the evening carried the wrong date --
   and the JSA board, which builds its signing window from the JSA's date,
   would not open for the crew until the following evening. Found in the
   2026-09-30 audit. */
export function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
