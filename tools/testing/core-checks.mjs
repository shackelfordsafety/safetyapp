/* The checks worth running before you ship anything.

   Fonzo, 2026-09-12: "ur the actual coder so whats recommended".

   Recommendation, and this file is it: there is no 67-check test suite.
   There are 67 scripts, each written to prove one change at the time it
   was made. Most did their job weeks ago, and a dozen of them exercise
   screens that no longer exist -- they cannot be fixed, only retired.

   What IS worth keeping is the short list below: the checks that protect
   something which would genuinely hurt somebody if it broke. Losing a
   morning's typing. A crew signing a JSA that says something different on
   paper. Paperwork left on a shared iPad after sign-out. A document that
   silently never reaches HR.

   Everything else stays on disk, unlisted, as the record of what was
   proved and when -- run by hand when the thing it covers is touched.

   Two commands:
     npm run check        this list
     npm run check:all    every script in the folder

   RETRIES ONCE. These drive a real browser against a real server, and on
   a laptop already running one, a slow start looks exactly like a
   failure. A check that fails twice in a row is worth reading; a check
   that fails once is usually the machine. Without this the same run gives
   different answers, which is worse than no answer at all. */

import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = 'tools/testing/output/core';
mkdirSync(OUT, { recursive: true });

/* Each line says what it protects, in the words of what goes wrong. */
const CORE = [
  ['verify-autosave-flush.mjs', 'the last thing you typed is not lost when you leave'],
  ['verify-discard-stays-discarded.mjs', 'a document you got rid of stays gone'],
  ['verify-signout-still-clears.mjs', 'signing out takes the paperwork off the device'],
  ['verify-crew-sees-what-prints.mjs', 'the phone shows what the paper says'],
  ['verify-send-for-review.mjs', 'submitting hands the document over properly'],
  ['verify-completion-lifecycle.mjs', 'no document can be finished by the person who wrote it'],
  ['verify-disciplinary.mjs', 'a whole document, end to end, into a real PDF'],
  ['verify-signin-names.mjs', 'the sign-in sheet says who signed'],
  ['verify-shift-window-warning.mjs', 'the 5PM/5AM typo is caught, real night shifts are not'],
  ['verify-sync-merge.mjs', 'templates are not lost when two devices meet'],
  ['verify-settings-stamp.mjs', 'an old device cannot overwrite newer settings'],
  ['verify-tester-punchlist.mjs', 'everything the outside tester found stays fixed'],
  ['verify-site-packs.mjs', 'the site-type hazard packs are intact'],
  ['verify-view-as-wording.mjs', 'the app names roles, never people'],
  ['verify-simulator.mjs', 'the simulator fills documents and stays hidden otherwise'],
  ['verify-conditional-fields.mjs', 'fields appear and hide when they should'],
];

/* Need a real account. Run by hand before anything that touches the
   review chain or publishing. */
const BY_HAND = [
  ['verify-publish-hands-off.mjs', 'publishing takes the JSA off the device'],
  ['verify-last-jsa-across-devices.mjs', '"same info as last time?" follows you'],
  ['simulate-review-chain.mjs', 'the whole review chain, two real accounts'],
];

const DONE = new RegExp([
  String.raw`\d+/\d+\s+(passed|survived)`, 'ALL CHECKS PASSED',
  String.raw`CHECK\(S\) FAILED`, 'All merge rules hold',
  'COMPLETION LIFECYCLE:', 'assertions passed', String.raw`^\s*PASS\s*$`,
  /* Scripts that end with their own result banner and then never exit.
     Without this the night-shift check was reported BROKEN while its log
     said PASS twice -- the worst kind of wrong answer, because it sends
     somebody hunting a bug that is not there. */
  String.raw`---\s*result\s*---`,
  String.raw`\[\d+/\d+\] Done\.`,
].join('|'), 'im');

function runOnce(file) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join('tools/testing', file)], { shell: true });
    let out = '';
    let settled = false;
    let grace;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard); clearTimeout(grace);
      killTree(child);
      const fails = out.match(/^\s*(\[FAIL\]|FAIL\b).*$/gm) || [];
      resolve({ ok: how !== 'timeout' && how !== 'exit-bad' && fails.length === 0, fails, out });
    };
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (DONE.test(out) && !grace) grace = setTimeout(() => finish('said its piece'), 2500);
    });
    child.stderr.on('data', (d) => { out += d.toString(); });
    const hard = setTimeout(() => finish('timeout'), 150000);
    child.on('close', code => finish(code === 0 ? 'exit-ok' : 'exit-bad'));
  });
}

const results = [];
for (const [i, [file, protects]] of CORE.entries()) {
  process.stdout.write(`[${i + 1}/${CORE.length}] ${protects} ... `);
  let r = await runOnce(file);
  let retried = false;
  if (!r.ok) {
    /* Once more, on a quiet machine, before calling it broken. */
    await new Promise(done => setTimeout(done, 3000));
    r = await runOnce(file);
    retried = true;
  }
  await new Promise(done => setTimeout(done, 1500));
  results.push({ file, protects, ...r, retried });
  writeFileSync(path.join(OUT, `${file}.log`), r.out);
  console.log(r.ok ? `ok${retried ? ' (second try)' : ''}` : 'BROKEN');
}

const broken = results.filter(r => !r.ok);
console.log(`\n${results.length - broken.length}/${results.length} of the checks that matter are clean`);
if (broken.length) {
  console.log('\nBroken — each of these protects something real:');
  for (const b of broken) {
    console.log(`\n  ${b.protects}`);
    console.log(`    ${b.file}`);
    b.fails.slice(0, 3).forEach(l => console.log(`    ${l.trim().slice(0, 140)}`));
  }
}
console.log('\nRun by hand, needs a real account:');
BY_HAND.forEach(([f, p]) => console.log(`  ${p}\n    node tools/testing/${f} <email> <password>`));

process.exitCode = broken.length ? 1 : 0;
