/* Run every check in the repo and write down what came back broken.

   Fonzo, 2026-09-12: "stress test every single aspect of this app and
   tell me what comes back fucked up".

   READS THE VERDICT OUT OF THE OUTPUT, not the exit code. Most of these
   scripts were written to be read by a person: several print a full pass
   report and then never exit at all, because the `vite preview` they
   spawned keeps Node's event loop alive on Windows. A first version of
   this runner waited 240 seconds for each of those and then called a
   perfectly healthy check "TIMED OUT" -- which would have put a pile of
   working features on a list of things that are broken.

   So: watch the output, and the moment a script says how it went, write
   that down and move on.

   Sequential on purpose -- each script starts its own preview server on
   its own fixed port, and two at once fight over it and both fail for a
   reason that has nothing to do with the app. */

import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = 'tools/testing';
const OUT = 'tools/testing/output/everything';
mkdirSync(OUT, { recursive: true });

/* Needs credentials or drives real accounts -- run by hand. */
const NEEDS_ACCOUNT = new Set([
  'simulate-review-chain.mjs',
  'capture-review-flow.mjs',
  'verify-publish-hands-off.mjs',
  'verify-last-jsa-across-devices.mjs',
  'verify-live-crew-signing.mjs',
  'verify-crew-board-live.mjs',
]);

/* Tools, not tests. */
const NOT_A_TEST = /^(extract-|build-sim-|capture-|render-|inspect-|crop-|analyze-|make-|review-package|walk-|generate-|run-everything|stress-the-app)/;

const HARD_LIMIT_MS = 150000;
/* A line that means the script has said its piece. */
const DONE = new RegExp([
  String.raw`\d+/\d+\s+(passed|survived)`,
  'ALL CHECKS PASSED', String.raw`CHECK\(S\) FAILED`,
  '=== RESULT ===', '=== OVERALL SUMMARY ===',
  'All merge rules hold', 'COMPLETION LIFECYCLE:', 'assertions passed',
  /* Several scripts end with a bare verdict line and then simply never
     exit, because the preview server they spawned keeps Node alive on
     Windows. Without these they get called hung -- and a working feature
     lands on a list of broken ones, which is worse than no list. */
  String.raw`^\s*PASS\s*$`,
  String.raw`No page errors\.`,
  'nothing to sign',
  String.raw`Saved .*screenshots`,
].join('|'), 'im');

const scripts = readdirSync(DIR)
  .filter(f => f.endsWith('.mjs'))
  .filter(f => !NOT_A_TEST.test(f))
  .filter(f => !NEEDS_ACCOUNT.has(f))
  .sort();

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [path.join(DIR, file)], { shell: true });
    let out = '';
    let settled = false;

    const finish = (how) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      clearTimeout(grace);
      try { child.kill(); } catch { /* already gone */ }
      const seconds = Math.round((Date.now() - started) / 1000);
      /* Only real FAIL lines. An earlier version also flagged any line
         ending ": false" -- which caught "keeps its own copy: false", a
         line that reports the GOOD answer. It put a passing check on the
         broken list. */
      const failLines = out.match(/^\s*(\[FAIL\]|FAIL\b).*$/gm) || [];
      let verdict = 'passed';
      if (how === 'timeout') verdict = 'NO ANSWER (hung)';
      else if (failLines.length) verdict = `${failLines.length} FAILED`;
      else if (how === 'exit-bad') verdict = 'CRASHED';
      resolve({ file, verdict, seconds, out, failLines });
    };

    let grace;
    child.stdout.on('data', d => {
      out += d.toString();
      /* Give it a moment after the verdict line in case more follows. */
      if (DONE.test(out) && !grace) grace = setTimeout(() => finish('said its piece'), 2500);
    });
    child.stderr.on('data', d => { out += d.toString(); });

    const hard = setTimeout(() => finish('timeout'), HARD_LIMIT_MS);
    child.on('close', code => finish(code === 0 ? 'exit-ok' : 'exit-bad'));
  });
}

const results = [];
for (const [i, file] of scripts.entries()) {
  process.stdout.write(`[${i + 1}/${scripts.length}] ${file} ... `);
  const r = await runOne(file);
  results.push(r);
  writeFileSync(path.join(OUT, `${file}.log`), r.out);
  console.log(`${r.verdict} (${r.seconds}s)`);
}

const broken = results.filter(r => r.verdict !== 'passed');
const lines = [];
lines.push(`Ran ${results.length} checks`);
lines.push(`${results.length - broken.length} clean, ${broken.length} came back broken`);
lines.push('');
for (const r of broken) {
  lines.push(`## ${r.file} — ${r.verdict}`);
  (r.failLines || []).slice(0, 6).forEach(l => lines.push(`   ${l.trim().slice(0, 150)}`));
  if (!r.failLines?.length) {
    const firstErr = (r.out.match(/^.*(crashed|Error:|waiting for).*$/m) || [])[0];
    if (firstErr) lines.push(`   ${firstErr.trim().slice(0, 150)}`);
  }
  lines.push('');
}
lines.push('Not run (need a real account):');
[...NEEDS_ACCOUNT].forEach(f => lines.push(`  ${f}`));

writeFileSync(path.join(OUT, 'SUMMARY.txt'), `${lines.join('\n')}\n`);
console.log(`\n${results.length - broken.length}/${results.length} clean`);
console.log(`summary -> ${path.join(OUT, 'SUMMARY.txt')}`);
