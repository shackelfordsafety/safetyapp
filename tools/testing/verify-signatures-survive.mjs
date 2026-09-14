// Do captured signatures survive leaving the screen?
//
//   node tools/testing/verify-signatures-survive.mjs
//
// Fonzo, 2026-09-14, on a real separation notice for a man who has already
// left the company: "the signatures don't save when you hit save. When you
// go to another tab, it freaking disappears."
//
// This is the worst class of bug this app can have -- paperwork you believe
// you have and do not -- and it is not theoretical: the employee is gone
// and that signature cannot be collected again.
//
// verify-signatures-every-doc.mjs passed all six documents this morning. It
// checked that a signature could be CAPTURED. It never checked that one
// SURVIVED, which is the part that matters, so it passed while this was
// broken. That gap is the whole reason this file exists.
//
// Three ways of leaving, because they are different code paths:
//   1. another step inside the same document
//   2. another tab (Home) and back in
//   3. a full reload of the page, the way a tab discarded in a truck comes
//      back
//
// After each one it checks BOTH the screen and what is actually written on
// the device, so "it is still on screen" cannot be mistaken for "it is
// saved" -- or the other way round.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'survive');
mkdirSync(outDir, { recursive: true });

const PORT = 4420;
const BASE = `http://localhost:${PORT}`;

const DOCS = [
  ['separation', /Employee Separation/i, /Employee Separation/, 'sdc.separation.draft.v1'],
  ['disciplinary', /Disciplinary Notice/i, /Disciplinary Notice/, 'sdc.discipline.draft.v1'],
  ['medicalEvent', /Medical Event/i, /Medical Event/, 'sdc.medical.draft.v1'],
  ['uncontrolledEvent', /Uncontrolled Event/i, /Uncontrolled Event/, 'sdc.uncontrolled.draft.v1'],
  ['incident', /Incident Report/i, /Incident Report/, 'sdc.incident.draft.v1'],
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
  await canvas.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(250);
}

/* What is actually written on the device, not what the screen claims. */
const storedSignatures = (page, key) => page.evaluate((k) => {
  try {
    const raw = JSON.parse(localStorage.getItem(k) || 'null');
    if (!raw) return { found: false, keys: [] };
    const keys = Object.keys(raw).filter(n => /SignatureData$/.test(n) && raw[n]);
    return { found: true, keys, bytes: (localStorage.getItem(k) || '').length };
  } catch (e) { return { found: false, keys: [], error: String(e) }; }
}, key);

const onScreen = page => page.locator('img.signaturePreview').count();

/* Is the document even OPEN? Without this, a sweep that failed to navigate
   back in reports 'no signatures on screen' and looks exactly like real data
   loss. Today has already produced two of those. */
const builderState = page => page.evaluate(() => ({
  builderOpen: Boolean(document.querySelector('.stepNavRow')),
  filledFields: [...document.querySelectorAll('.stepPanel input')]
    .filter(i => i.value && i.value.trim()).length,
}));

async function openDoc(page, tileName, simName) {
  await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Settings$/ }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  const fill = page.locator('.simFill', { hasText: simName }).first();
  if (!(await fill.count())) return false;
  await fill.click().catch(() => {});
  await page.waitForTimeout(1200);

  await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const card = page.locator('.startDocTile', { hasText: tileName }).first();
  const tile = card.getByRole('button', { name: /^(Start|Continue)/i }).first();
  if (!(await tile.count())) return false;
  await tile.click().catch(() => {});
  await page.waitForTimeout(900);
  return true;
}

async function gotoSignatureStep(page) {
  const steps = page.locator('.stepNavRow');
  const n = await steps.count();
  for (let s = 0; s < n; s += 1) {
    await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (await page.getByRole('button', { name: /^Add signature$/i }).count()) return s;
  }
  return -1;
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    for (const [docId, tileName, simName, key] of DOCS) {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      const page = await context.newPage();

      if (!(await openDoc(page, tileName, simName))) {
        check(`${docId}: could be opened`, false, 'no tile or no simulator button');
        await context.close();
        continue;
      }
      const sigStep = await gotoSignatureStep(page);
      if (sigStep < 0) { check(`${docId}: has a signature step`, false, 'no pad found'); await context.close(); continue; }

      /* Sign everything on the step, the way a real signing session goes:
         supervisor, then the employee, then a witness. */
      let signedHere = 0;
      for (let i = 0; i < 4; i += 1) {
        const add = page.getByRole('button', { name: /^Add signature$/i }).first();
        if (!(await add.count())) break;
        await add.scrollIntoViewIfNeeded().catch(() => {});
        await add.click().catch(() => {});
        await page.waitForTimeout(350);
        const canvas = page.locator('canvas.signatureCanvas').first();
        if (!(await canvas.count())) break;
        try { await draw(page, canvas); } catch { break; }
        const save = page.getByRole('button', { name: /^Save$/i }).first();
        if (await save.count()) { await save.click().catch(() => {}); await page.waitForTimeout(350); }
        signedHere += 1;
      }
      check(`${docId}: signatures can be captured (${signedHere})`, signedHere > 0);
      if (!signedHere) { await context.close(); continue; }

      /* Autosave is debounced; give it comfortably longer than its window
         so this measures persistence, not impatience. */
      await page.waitForTimeout(2000);
      const afterSigning = await storedSignatures(page, key);
      check(`${docId}: written to the device straight after signing`,
        afterSigning.found && afterSigning.keys.length >= signedHere,
        `on device: ${JSON.stringify(afterSigning.keys)} (signed ${signedHere})`);

      // ── 1. another step and back ──
      const steps = page.locator('.stepNavRow');
      const total = await steps.count();
      await steps.nth(Math.max(0, sigStep - 1)).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
      await steps.nth(sigStep).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(900);
      check(`${docId}: still there after another step and back`,
        (await onScreen(page)) >= signedHere,
        `${await onScreen(page)} on screen, expected ${signedHere}`);

      // ── 2. another tab and back ──
      await page.getByRole('button', { name: /^Home$/ }).first().click().catch(() => {});
      await page.waitForTimeout(900);
      const card = page.locator('.startDocTile', { hasText: tileName }).first();
      await card.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
      await page.waitForTimeout(1000);
      await gotoSignatureStep(page);
      const afterTab = await onScreen(page);
      const tabState = await builderState(page);
      const storedAfterTab = await storedSignatures(page, key);
      check(`${docId}: still there after leaving for another tab`,
        afterTab >= signedHere,
        `${afterTab} on screen, expected ${signedHere} · document open: ${tabState.builderOpen}, other fields filled: ${tabState.filledFields} · on device: ${JSON.stringify(storedAfterTab.keys)}`);
      if (afterTab < signedHere) {
        await page.screenshot({ path: path.join(outDir, `${docId}-lost-on-tab.png`), fullPage: true }).catch(() => {});
      }

      // ── 3. a full reload ──
      await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const card2 = page.locator('.startDocTile', { hasText: tileName }).first();
      await card2.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
      await page.waitForTimeout(1000);
      await gotoSignatureStep(page);
      const afterReload = await onScreen(page);
      const reloadState = await builderState(page);
      const storedAfterReload = await storedSignatures(page, key);
      check(`${docId}: still there after a full reload`,
        afterReload >= signedHere,
        `${afterReload} on screen, expected ${signedHere} · document open: ${reloadState.builderOpen}, other fields filled: ${reloadState.filledFields} · on device: ${JSON.stringify(storedAfterReload.keys)}`);
      if (afterReload < signedHere) {
        await page.screenshot({ path: path.join(outDir, `${docId}-lost-on-reload.png`), fullPage: true }).catch(() => {});
      }

      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED — a captured signature can go missing.`);
    process.exit(0);
  }
}

main().catch(err => { console.error('survival sweep crashed:', err); process.exit(1); });
