// Verifies the 2026-08-31 "blank signature lines" field on the JSA
// Signatures step: when the crew kiosk has NOT been used, the field is
// editable and drives the actual number of blank pen-signature lines that
// print. The moment kiosk sign-in starts, the field must NOT reappear
// (that path stays fully automatic, per the 2026-08-19 "no more choosing"
// decision). Drives the real UI + real PDF export via Playwright.
//
// node tools/testing/verify-jsa-blank-signature-lines.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'blank-signature-lines');
mkdirSync(outDir, { recursive: true });

const jsaDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

const PORT = 4331;
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

async function main() {
  console.log('[1/6] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/6] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, jsaDraft);
    const page = await context.newPage();
    const consoleErrors = []; const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    console.log('[3/6] Loading fixture (no crew signatures yet) and opening Signatures step...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('tab', { name: /^Signatures/ }).click();

    const lineInput = page.locator('.sigRuleBox input[type="number"]');
    await lineInput.waitFor({ state: 'visible' });
    check((await lineInput.inputValue()) === '80', `Field shows the fixture's real stored signatureLineCount (80), got "${await lineInput.inputValue()}"`);

    console.log('[4/6] Setting blank line count to 12 (kiosk untouched)...');
    await lineInput.fill('12');
    await lineInput.blur();
    await page.waitForTimeout(1800); // draft autosave is 900ms-debounced; wait it out (with margin)
    // Read localStorage directly rather than reloading -- this context's addInitScript
    // re-seeds the fixture (signatureLineCount: 80) on every navigation, which would
    // clobber the just-saved value and make this check meaningless.
    const persistedRaw = await page.evaluate(() => JSON.parse(localStorage.getItem('sdc.jsa.draft.v4')).signatureLineCount);
    check(Number(persistedRaw) === 12, `Custom count of 12 autosaved to localStorage, got "${persistedRaw}"`);

    console.log('[5/6] Generating the real PDF with 12 blank lines, no kiosk signatures...');
    await page.getByRole('tab', { name: /^Finish & Export/ }).click();
    await page.locator('.reviewPrimaryAction button, .btn.primary.lg').first().click();
    // exportPreflight() shows a native confirm() since crew sign-in reads as an incomplete review item -- accept it.
    page.once('dialog', d => d.accept());
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
    const headline = await page.locator('.pdfReadyHeadline').innerText();
    console.log(`  PDF ready: ${headline.trim()}`);

    const { savedTo } = await downloadGeneratedPdf(page, path.join(outDir, 'blank-signature-lines-12.pdf'));
    console.log('  Saved PDF ->', savedTo);

    console.log('[6/6] Confirming the field disappears once kiosk sign-in starts...');
    await page.getByRole('tab', { name: /^Signatures/ }).click();
    await page.getByRole('button', { name: 'Start Crew Sign-In' }).click();
    await page.locator('.crewKiosk').waitFor({ state: 'visible' });
    const canvas = page.locator('.crewKioskCanvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await page.mouse.up();
    await page.locator('.crewKioskConfirm').click();
    await page.locator('.crewKioskConfirmedOverlay').waitFor({ state: 'hidden', timeout: 4000 });
    await page.locator('.crewKioskExitHold').click();
    await page.getByRole('button', { name: 'Done Signing' }).click();
    await page.locator('.crewKiosk').waitFor({ state: 'hidden', timeout: 3000 });
    await page.getByRole('tab', { name: /^Signatures/ }).click();
    const inputGoneAfterKiosk = await page.locator('.sigRuleBox input[type="number"]').count();
    check(inputGoneAfterKiosk === 0, 'Editable field is gone once at least one kiosk signature exists (reverts to automatic "20 extra" copy)');

    check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
    check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\nDone. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
