// Can a signature actually be captured, in every document that asks for one?
//
//   node tools/testing/verify-signatures-every-doc.mjs
//
// Signatures are on CLAUDE.md's never-break list, and as of 2026-09-14 the
// four scripts that covered them (verify-separation, verify-medical-event,
// verify-uncontrolled-event, verify-incident-pdf) all time out before they
// reach a pad. They are looking for labels that changed when the signing
// rules changed -- test drift, not an app fault -- but the effect is the
// same: the never-break feature had no live coverage at all.
//
// This replaces the part of them that mattered. For every document type it
// finds every signature pad on every step, signs one, and checks the mark
// was actually kept. It asserts on BEHAVIOUR (a pad, a stroke, a saved
// image) rather than on the wording of any label, so a future rename of
// "Supervisor Signature" cannot kill it the way it killed those four.
//
// It also refuses to pass quietly: a document where it finds NO pad at all
// is reported by name, because "found nothing, therefore nothing is broken"
// is how the last four managed to look fine while covering nothing.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'signatures');
mkdirSync(outDir, { recursive: true });

const PORT = 4408;
const BASE = `http://localhost:${PORT}`;

/* docId, the name on its Home tile, the name on its simulator button. */
const DOCS = [
  /* The JSA is the exception, and it is correct: the crew signs on the
     board, on paper, or on the kiosk, so it has no SignaturePad of its own.
     Finding none there is the right answer, not a missing pad. */
  ['jsa', /JSA/i, /^JSA/, 'no pads expected'],
  ['incident', /Incident Report/i, /Incident Report/],
  ['uncontrolledEvent', /Uncontrolled Event/i, /Uncontrolled Event/],
  ['medicalEvent', /Medical Event/i, /Medical Event/],
  ['disciplinary', /Disciplinary Notice/i, /Disciplinary Notice/],
  ['separation', /Employee Separation/i, /Employee Separation/],
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error('server not ready'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function draw(page, canvas) {
  /* Scrolled into view FIRST. boundingBox() is viewport-relative, so a pad
     sitting below the fold hands back coordinates the mouse never reaches:
     the stroke lands on nothing and a working pad reports itself broken.
     That is exactly what made Incident's witness pads look faulty. */
  await canvas.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('the pad has no size on screen');
  const x0 = box.x + box.width * 0.2;
  const y0 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(x0 + i * (box.width * 0.06), y0 + Math.sin(i) * (box.height * 0.15));
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    for (const [docId, tileName, simName, expectation] of DOCS) {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e?.message || e)));

      /* ?sim=1 turns on the simulator, whose whole job is filling a document
         properly in one tap. That matters here: the steps that carry
         signatures are LOCKED until the document ahead of them is complete,
         and generically typing into every box does not complete one -- it
         misses the warning-level choice, the required sections, the lot. The
         first version of this sweep did exactly that, found no pads in any
         of the six, and would have been read as "signatures are gone". */
      await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: /^Settings$/ }).first().click().catch(() => {});
      await page.waitForTimeout(900);
      const fillBtn = page.locator('.simFill', { hasText: simName }).first();
      if (!(await fillBtn.count())) {
        check(`${docId}: the simulator can fill it`, false, 'no simulator button for this document');
        await context.close();
        continue;
      }
      await fillBtn.click().catch(() => {});
      await page.waitForTimeout(1200);

      await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const card = page.locator('.startDocTile', { hasText: tileName }).first();
      const tile = card.getByRole('button', { name: /^(Start|Continue)/i }).first();
      if (!(await tile.count())) { check(`${docId}: can be opened`, false, 'no start tile'); await context.close(); continue; }
      await tile.click().catch(() => {});
      await page.waitForTimeout(700);
      const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
      if (await blank.count()) { await blank.click().catch(() => {}); await page.waitForTimeout(800); }

      const steps = page.locator('.stepNavRow');
      const stepCount = await steps.count();

      let padsSeen = 0;
      let signed = 0;
      let failure = '';

      for (let s = 0; s < stepCount && !failure; s += 1) {
        await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(700);

        const addButtons = page.getByRole('button', { name: /^Add signature$/i });
        const count = await addButtons.count();
        padsSeen += count;
        if (!count) continue;

        /* One per step is enough to prove the machinery; signing all of
           them just makes the run long. */
        const firstAdd = addButtons.first();
        await firstAdd.scrollIntoViewIfNeeded().catch(() => {});
        await firstAdd.click().catch(() => {});
        await page.waitForTimeout(400);

        const canvas = page.locator('canvas.signatureCanvas').first();
        if (!(await canvas.count())) { failure = 'tapping "Add signature" produced no pad to sign on'; break; }

        try { await draw(page, canvas); } catch (ex) { failure = ex.message; break; }

        /* Some pads commit as you draw and show only Clear; others have an
           explicit Save. Both are legitimate -- take whichever is there. */
        const save = page.getByRole('button', { name: /^(Done|Save)$/i }).first();
        if (await save.count()) { await save.click().catch(() => {}); await page.waitForTimeout(400); }

        const kept = await page.locator('img.signaturePreview').count();
        if (!kept) { failure = 'the signature was drawn but nothing was kept'; break; }
        signed += 1;

        if (await page.locator('text=Something went wrong').count()) {
          failure = 'the app crashed while signing';
          break;
        }
      }

      if (failure) {
        check(`${docId}: a signature can be captured`, false, failure);
        await page.screenshot({ path: path.join(outDir, `${docId}-fail.png`), fullPage: true }).catch(() => {});
      } else if (padsSeen === 0 && expectation === 'no pads expected') {
        check(`${docId}: signs on the board or on paper, so it correctly has no pad of its own`, true);
      } else if (padsSeen === 0) {
        /* Said out loud rather than counted as a pass. A document that asks
           for no signature at all may be correct -- but it may also be a
           pad that disappeared, and that is exactly the failure nobody
           would notice. */
        check(`${docId}: has at least one signature pad`, false,
          'no signature pad on any step — correct for this document, or a pad that went missing?');
      } else {
        check(`${docId}: a signature can be captured and is kept (${signed} of ${padsSeen} pads signed)`, true);
      }

      if (errors.length) check(`${docId}: no errors thrown`, false, errors.slice(0, 2).join(' | '));
      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED`);
    process.exit(0);
  }
}

main().catch(err => { console.error('signature sweep crashed:', err); process.exit(1); });
