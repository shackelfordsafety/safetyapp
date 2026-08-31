// Verifies the JSA Signatures step's explicit "How will this JSA be
// signed?" choice (2026-08-31, second pass): Kiosk (default) vs Print &
// Sign in Pen. In Print mode, the blank-line count (1-100) is editable and
// drives the actual number of blank pen-signature lines that print, and
// "Ready for Crew to Sign" on Review must NOT barge into the kiosk when
// Print mode is selected. In Kiosk mode the count field is not shown at
// all -- that path stays fully automatic (crew signs, kiosk auto-sets 20
// extra blank lines), per the 2026-08-19 "no more choosing" decision.
// Drives the real UI + real PDF export via Playwright.
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
  console.log('[1/7] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/7] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, jsaDraft);
    const page = await context.newPage();
    const consoleErrors = []; const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    console.log('[3/7] Loading fixture and opening Signatures step (default mode)...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('tab', { name: /^Signatures/ }).click();

    check((await page.locator('.sigRuleBox input[type="number"]').count()) === 0, 'No blank-line field shown by default (Kiosk is the default mode)');
    await page.getByRole('button', { name: 'Kiosk — Sign on This Device', exact: true }).click();
    check((await page.locator('.sigRuleBox input[type="number"]').count()) === 0, 'Still no blank-line field with Kiosk explicitly selected');

    console.log('[4/7] Switching to Print & Sign in Pen...');
    await page.getByRole('button', { name: 'Print & Sign in Pen', exact: true }).click();
    const lineInput = page.locator('.sigRuleBox input[type="number"]');
    await lineInput.waitFor({ state: 'visible' });
    check((await lineInput.inputValue()) === '80', `Field shows the fixture's real stored signatureLineCount (80), got "${await lineInput.inputValue()}"`);
    check((await page.getByRole('button', { name: 'Start Crew Sign-In' }).count()) === 0, 'Kiosk start button is gone in Print mode');

    console.log('[5/7] Setting blank line count to 12...');
    await lineInput.fill('12');
    await lineInput.blur();
    await page.waitForTimeout(1800); // draft autosave is 900ms-debounced; wait it out (with margin)
    // Read localStorage directly rather than reloading -- this context's addInitScript
    // re-seeds the fixture (signatureLineCount: 80) on every navigation, which would
    // clobber the just-saved value and make this check meaningless.
    const persistedRaw = await page.evaluate(() => JSON.parse(localStorage.getItem('sdc.jsa.draft.v4')).signatureLineCount);
    check(Number(persistedRaw) === 12, `Custom count of 12 autosaved to localStorage, got "${persistedRaw}"`);
    const persistedMode = await page.evaluate(() => JSON.parse(localStorage.getItem('sdc.jsa.draft.v4')).signInMode);
    check(persistedMode === 'printout', `signInMode persisted as "printout", got "${persistedMode}"`);

    console.log('[6/7] "Ready for Crew to Sign" must not open the kiosk in Print mode...');
    await page.getByRole('tab', { name: /^Review/ }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Ready for Crew to Sign' }).click();
    await page.waitForTimeout(300);
    check((await page.locator('.crewKiosk').count()) === 0, 'Kiosk did not open — Print & Sign in Pen mode was respected');

    console.log('[7/7] Generating the real PDF with 12 blank lines, no kiosk signatures...');
    await page.getByRole('tab', { name: /^Finish & Export/ }).click();
    await page.locator('.reviewPrimaryAction button, .btn.primary.lg').first().click();
    // exportPreflight() shows a native confirm() since crew sign-in reads as an incomplete review item -- accept it.
    page.once('dialog', d => d.accept());
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
    const headline = await page.locator('.pdfReadyHeadline').innerText();
    console.log(`  PDF ready: ${headline.trim()}`);

    const { savedTo } = await downloadGeneratedPdf(page, path.join(outDir, 'blank-signature-lines-12.pdf'));
    console.log('  Saved PDF ->', savedTo);

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
