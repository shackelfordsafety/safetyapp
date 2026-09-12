// Verifies the JSA Crew Sign-In Kiosk's captured signatures actually print
// on the attached sign-in sheet: digital signatures filled in (numbered,
// image embedded), followed by the configured count of blank pen-sign lines
// after them. Drives the real kiosk with real drawn strokes (not fabricated
// data URLs) via Playwright, then generates the real PDF and extracts the
// actual html2canvas raster for visual review (see CLAUDE.md's "Generating
// review screenshots/PDFs").
//
// node tools/testing/verify-jsa-crew-signin-print.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'crew-signin-print');
mkdirSync(outDir, { recursive: true });

const jsaDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

const PORT = 4328;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Server at ${url} did not become ready in time`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label}`); failures += 1; }
}

async function drawSignature(page, canvasLocator, seed) {
  const box = await canvasLocator.boundingBox();
  const x0 = box.x + box.width * 0.15;
  const y0 = box.y + box.height * 0.5 + (seed % 3) * 15 - 15;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(x0 + i * (box.width * 0.07), y0 + Math.sin(i + seed) * 22);
  }
  await page.mouse.up();
}

async function main() {
  console.log('[1/5] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/5] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, jsaDraft);
    const page = await context.newPage();
    const consoleErrors = []; const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    console.log('[3/5] Signing in 6 crew members via the real kiosk...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('tab').last().click();
    await page.getByRole('button', { name: 'Start Crew Sign-In' }).click();
    await page.locator('.crewKiosk').waitFor({ state: 'visible' });

    const canvas = page.locator('.crewKioskCanvas');
    const confirmBtn = page.locator('.crewKioskConfirm');
    for (let i = 0; i < 6; i += 1) {
      await drawSignature(page, canvas, i * 17);
      await confirmBtn.click();
      await page.locator('.crewKioskConfirmedOverlay').waitFor({ state: 'hidden', timeout: 4000 });
    }
    check((await page.locator('.crewKioskNumber').innerText()).includes('#7'), 'Kiosk advanced to signer #7 after 6 real signatures');

    // Exit via the hold control.
    const exitBox = await page.locator('.crewKioskExitHold').boundingBox();
    await page.mouse.move(exitBox.x + exitBox.width / 2, exitBox.y + exitBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1700);
    await page.mouse.up();
    await page.locator('.crewKiosk').waitFor({ state: 'hidden', timeout: 3000 });

    // Set a small, easy-to-eyeball extra-blank-lines count (Fonzo's "20 or
    // so" concept, using a small number here purely so the review screenshot
    // shows both filled and blank rows on one page without scrolling).
    console.log('[4/5] Setting extra blank lines to 5, generating the real PDF...');
    const extraInput = page.locator('.sigSetup input[type="number"]');
    await extraInput.fill('5');
    await extraInput.blur();
    // .field span renders text-transform:uppercase -- compare case-insensitively.
    const labelText = await page.locator('.sigSetup .field span').first().innerText();
    check(labelText.toLowerCase().includes('extra blank lines'), `Signature-lines label switches to "Extra Blank Lines" copy once crew has signed (got "${labelText}")`);

    await page.getByRole('tab').last().click();
    await page.locator('.reviewPrimaryAction button').click();
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
    const headline = await page.locator('.pdfReadyHeadline').innerText();
    console.log(`  PDF ready: ${headline.trim()}`);

    const { savedTo } = await downloadGeneratedPdf(page, path.join(outDir, 'crew-signin-print.pdf'));
    console.log('  Saved PDF ->', savedTo);

    check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
    check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[5/5] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
