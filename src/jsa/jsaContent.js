/* ── What is actually on a JSA ───────────────────────────────────────────
   ONE answer to "what tasks, hazards and controls does this JSA carry",
   used by everything that shows or prints one.

   WHY THIS FILE EXISTS. There were two answers, and they disagreed. The
   printed form merged the detailed task rows WITH whatever was typed into
   the summary fields; the crew's phone used the detailed rows and ignored
   the summary fields entirely the moment any row existed. So a JSA written
   from an older template that carries task rows, then added to with a new
   hazard in the summary box, printed that hazard on the paper and did not
   show it on the phone.

   That is the worst kind of bug this app can have. A man reads the JSA on
   his phone and signs to say he has reviewed it. If the paper says
   something his phone did not, he has signed for a document he was never
   shown. Found by an outside reviewer, 2026-09-11.

   Extracted out of main.jsx so board.js can share it rather than keeping
   its own near-copy, because a near-copy is how the two drifted apart in
   the first place. */

export function hasText(v) {
  return Boolean(String(v || '').trim());
}

/* Newlines AND semicolons: the pre-built task bundles write a whole list
   of controls into one field separated by semicolons, and those are
   separate controls to a man reading them. */
export function splitLines(v) {
  return String(v || '').split(/\n|;/).map(s => s.trim()).filter(Boolean);
}

export function normalizeEntry(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryTokens(value) {
  const stop = new Set(['a', 'an', 'and', 'as', 'at', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'when', 'where', 'with']);
  return normalizeEntry(value).split(' ').filter(token => token.length > 2 && !stop.has(token));
}

export function isNearDuplicate(a, b) {
  const na = normalizeEntry(a);
  const nb = normalizeEntry(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) >= 12 && (na.includes(nb) || nb.includes(na))) return true;
  const aa = new Set(entryTokens(a));
  const bb = new Set(entryTokens(b));
  if (!aa.size || !bb.size) return false;
  const intersection = [...aa].filter(token => bb.has(token)).length;
  const union = new Set([...aa, ...bb]).size;
  return union > 0 && intersection / union >= 0.82;
}

/* The placeholder step a blank template ships with. Not real content, and
   it must not stop the summary fields being read. */
export function isGenericRow(row) {
  const s = String(row?.step || '').trim().toLowerCase();
  return !s
    || s === 'daily tasks as discussed during tailgate meeting'
    || s === 'daily tasks as discussed during the tailgate meeting';
}

export function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => hasText(r.step) || hasText(r.hazards) || hasText(r.controls));
}

export function rowsFromSummary(jsa) {
  const steps = splitLines(jsa?.dailyTasks);
  const haz = splitLines(jsa?.hazardsSummary);
  const con = splitLines(jsa?.controlsSummary);
  const n = Math.max(steps.length, haz.length, con.length);
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => ({ step: steps[i] || '', hazards: haz[i] || '', controls: con[i] || '' }));
}

/* Detailed rows win where they cover the same ground; anything in the
   summary fields they do NOT cover is kept rather than dropped. */
export function getContentRows(jsa) {
  const detailed = normalizeRows(jsa?.taskRows).filter(row => !isGenericRow(row));
  const summary = rowsFromSummary(jsa);
  if (!detailed.length) return summary;
  const remainingSummary = summary.filter((row) => {
    if (!hasText(row.step)) return hasText(row.hazards) || hasText(row.controls);
    return !detailed.some(detail => isNearDuplicate(detail.step, row.step));
  });
  return [...detailed, ...remainingSummary];
}

/* Three independent lists -- what a JSA actually is. Deduplicated, because
   the same control legitimately arrives from both a task bundle and the
   summary field, and printing "Wear required PPE" twice makes a man stop
   and wonder what he missed.

   This is now the ONLY source for the printed form, the on-screen preview
   and the crew's phone. */
export function getContentColumns(jsa) {
  const tasks = [];
  const hazards = [];
  const controls = [];
  const push = (into, value) => {
    splitLines(value).forEach((line) => {
      const text = line.trim();
      if (!text) return;
      if (into.some(existing => normalizeEntry(existing) === normalizeEntry(text))) return;
      into.push(text);
    });
  };
  getContentRows(jsa).forEach((row) => {
    push(tasks, row.step);
    push(hazards, row.hazards);
    push(controls, row.controls);
  });
  return { tasks, hazards, controls };
}
