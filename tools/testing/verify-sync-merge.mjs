// The merge rules behind template sync, tested directly.
//
// This is the part worth testing hard. The network half is thin and fails
// safe -- if it can't reach the cloud the device keeps its own copy, which
// is exactly how the app behaved before sync existed. The merge is where
// data actually gets lost: a rule that's slightly wrong doesn't error, it
// quietly eats a template somebody built, or resurrects one they deleted
// over and over forever.
//
// Usage: node tools/testing/verify-sync-merge.mjs

import { mergeTemplates, mergeTombstones } from '../../src/sync/mergeRules.js';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${e}\n        got      ${a}`);
}

const t = (id, name, updatedAt) => ({ id, name, updatedAt, createdAt: updatedAt, data: {} });
const names = list => list.map(x => x.name);

const OLD = '2026-09-01T08:00:00.000Z';
const MID = '2026-09-05T08:00:00.000Z';
const NEW = '2026-09-09T08:00:00.000Z';

// 1. The everyday case: each device has one the other has never seen.
check('both devices keep what the other made',
  names(mergeTemplates([t('a', 'Entergy', MID)], [t('b', 'TAPS Night', MID)], [])).sort(),
  ['Entergy', 'TAPS Night']);

// 2. Same template edited in two places -- newest edit wins, and nothing
//    is duplicated.
check('newer edit of the same template wins',
  names(mergeTemplates([t('a', 'Entergy v2', NEW)], [t('a', 'Entergy v1', OLD)], [])),
  ['Entergy v2']);

check('older local does not clobber newer cloud',
  names(mergeTemplates([t('a', 'Entergy v1', OLD)], [t('a', 'Entergy v2', NEW)], [])),
  ['Entergy v2']);

// 3. THE ONE THAT MATTERS. Delete on the iPad; the phone still has it.
//    Without tombstones this comes back every single sync, forever.
check('a deleted template stays deleted',
  names(mergeTemplates([], [t('a', 'Entergy', MID)], [{ id: 'a', at: NEW }])),
  []);

// 4. ...but a deletion must not eat a LATER edit made elsewhere. Deleted
//    Monday, edited Tuesday on the phone -> the edit is the newer
//    intention and the template lives.
check('an edit made after the delete survives',
  names(mergeTemplates([t('a', 'Entergy', NEW)], [], [{ id: 'a', at: MID }])),
  ['Entergy']);

// 5. Convergence. Merging the result again must not change it, or two
//    devices ping-pong forever and every sync writes a new row.
const once = mergeTemplates([t('a', 'A', NEW)], [t('b', 'B', MID)], []);
check('merging twice changes nothing', mergeTemplates(once, once, []), once);

// 6. Ordering is deterministic -- newest first -- so the Templates screen
//    doesn't reshuffle itself every sync.
check('newest first',
  names(mergeTemplates([t('a', 'Old', OLD), t('c', 'New', NEW)], [t('b', 'Mid', MID)], [])),
  ['New', 'Mid', 'Old']);

// 7. Garbage in from an older version, a half-written row, private mode.
//    None of it may throw -- this runs on every app open.
check('null and undefined are survivable', mergeTemplates(null, undefined, null), []);
check('entries with no id are ignored', names(mergeTemplates([{ name: 'no id' }], [], [])), []);
check('a non-array where a list belongs', mergeTemplates({ nope: 1 }, 'garbage', []), []);

// 8. Tombstones themselves: newest wins, duplicates collapse, ancient ones
//    are forgotten so the list can't grow without limit.
check('tombstones collapse by id',
  mergeTombstones([{ id: 'a', at: OLD }], [{ id: 'a', at: NEW }]),
  [{ id: 'a', at: NEW }]);

const ancient = new Date(Date.now() - 200 * 86400000).toISOString();
check('tombstones older than the window are dropped',
  mergeTombstones([{ id: 'a', at: ancient }], []),
  []);

check('recent tombstones are kept',
  mergeTombstones([{ id: 'a', at: new Date().toISOString() }], []).length,
  1);

console.log(failures === 0 ? '\nAll merge rules hold.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
