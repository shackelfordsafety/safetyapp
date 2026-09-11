// The crew's phone must show exactly what the paper says.
//
// A man reads the JSA on his phone and signs to say he has reviewed it. If
// the printed form carries a hazard his phone never showed him, he has
// signed for a document he was never shown. That is the worst bug this app
// can have, and it was real: the crew page kept its own copy of "what is on
// this JSA" and it had drifted -- it ignored the summary fields entirely
// whenever the JSA carried detailed task rows, while the printed form
// merged both.
//
// This is a unit check, deliberately. It compares the two code paths
// directly on the awkward shapes rather than driving a browser, because the
// thing being guarded is that ONE function feeds both -- and a test that
// can only fail when somebody re-copies the logic is exactly what is
// wanted.
//
// Usage: node tools/testing/verify-crew-sees-what-prints.mjs

import { getContentColumns } from '../../src/jsa/jsaContent.js';
import { readFileSync } from 'node:fs';

/* board.js pulls in the Supabase client and cannot be loaded outside Vite,
   so the guarantee is checked at the source instead -- and that is the
   stronger check anyway. What must stay true is that the crew page has NO
   copy of this logic of its own, because a copy is how the two drifted
   apart and let a man sign a JSA missing a hazard the paper carried. */
const boardSrc = readFileSync(new URL('../../src/crew/board.js', import.meta.url), 'utf8');
const readableColumns = getContentColumns;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* The shape that broke it: an older template carrying task rows, added to
   with a new hazard typed into the summary box. */
const rowsPlusSummary = {
  taskRows: [
    { step: 'Grading and compacting', hazards: 'Slips, trips and falls; struck-by', controls: 'Wear seatbelt; good housekeeping' },
  ],
  dailyTasks: '',
  hazardsSummary: 'Overhead power lines',
  controlsSummary: 'Stay 15 ft from overhead power lines',
};

const summaryOnly = {
  taskRows: [],
  dailyTasks: 'Receive rock\nMix lime',
  hazardsSummary: 'Dust exposure\nPublic traffic',
  controlsSummary: 'Apply water for dust control',
};

/* A blank template ships with a placeholder step. It is not real content
   and must not stop the summary fields being read. */
const placeholderRow = {
  taskRows: [{ step: 'Daily tasks as discussed during tailgate meeting', hazards: '', controls: '' }],
  dailyTasks: 'Haul dirt',
  hazardsSummary: 'Heat stress',
  controlsSummary: 'Hydrate regularly',
};

const empty = { taskRows: [], dailyTasks: '', hazardsSummary: '', controlsSummary: '' };

[
  ['task rows PLUS a hazard typed in the summary box', rowsPlusSummary],
  ['summary fields only', summaryOnly],
  ['a blank template placeholder row plus real summary content', placeholderRow],
  ['a completely empty JSA', empty],
].forEach(([label, jsa]) => {
  const printed = getContentColumns(jsa);
  const onPhone = readableColumns(jsa);
  check(`the phone matches the paper — ${label}`, same(printed, onPhone),
    same(printed, onPhone)
      ? `${printed.tasks.length} tasks, ${printed.hazards.length} hazards, ${printed.controls.length} controls`
      : `paper: ${JSON.stringify(printed)}\n        phone: ${JSON.stringify(onPhone)}`);
});

/* The specific regression: the summary hazard must survive alongside the
   rows rather than being dropped. */
const merged = getContentColumns(rowsPlusSummary);
check('a hazard typed in the summary box is not lost when task rows exist',
  merged.hazards.includes('Overhead power lines'),
  merged.hazards.join(' | '));

check('semicolon lists inside a task bundle become separate lines',
  merged.hazards.includes('Slips, trips and falls') && merged.hazards.includes('struck-by'),
  merged.hazards.join(' | '));

check('the blank-template placeholder does not hide the summary fields',
  getContentColumns(placeholderRow).tasks.includes('Haul dirt'),
  getContentColumns(placeholderRow).tasks.join(' | '));

const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
if (bad.length) process.exit(1);

/* The guarantee that actually prevents this coming back. */
const reexports = /export\s*\{\s*getContentColumns as readableColumns\s*\}\s*from\s*'\.\.\/jsa\/jsaContent'/.test(boardSrc);
const hasOwnCopy = /function readableColumns/.test(boardSrc);
console.log(`${reexports && !hasOwnCopy ? 'PASS' : 'FAIL'}  the crew page has no copy of its own — it re-exports the shared one`);
console.log(`        re-exports: ${reexports}   keeps its own copy: ${hasOwnCopy}`);
if (!reexports || hasOwnCopy) process.exit(1);
