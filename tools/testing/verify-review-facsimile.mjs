// TEMPORARY verification script (2026-08-13 C2 redesign phase 3a: Review
// facsimile for JSA + Incident).
//
// Not part of the application build or bundle. Drives the real UI to:
//   1. Screenshot JSA's Review step at desktop width (side-by-side "What
//      Will Print" panel) and iPad/narrow width (stacked below).
//   2. Same for Incident Report.
//   3. Generate + download a real PDF for each, to confirm the PDF export
//      pipeline (untouched by this change) still works.
//
// node tools/testing/verify-review-facsimile.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'review-facsimile');
mkdirSync(outDir, { recursive: true });

const jsaDraft = readFileSync(path.join(__dirname, 'fixtures', 'jsa-stress-messy-continuation.json'), 'utf8');
const incidentDraft = readFileSync(path.join(__dirname, 'fixtures', 'incident-user-draft-fixture.json'), 'utf8');
JSON.parse(jsaDraft);
JSON.parse(incidentDraft);

const PORT = 4321;
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

async function main() {
  console.log('[1] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ── JSA: desktop wide (side-by-side) ──
    {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, jsaDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[jsa-desktop] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[jsa-desktop] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Finish & Export/ }).click();
      await page.locator('.previewSheetCanvas').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, 'jsa-review-desktop-wide.png'), fullPage: true });
      console.log('[3] JSA desktop-wide Review screenshot saved');

      console.log('[4] Generating real JSA PDF...');
      await page.locator('.reviewPrimaryAction button').click();
      await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.pdfReadyPanel button:has-text("Download")').click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'jsa-generated.pdf'));
      console.log('    Saved -> jsa-generated.pdf');
      await context.close();
    }

    // ── JSA: narrow/iPad width (stacked) ──
    {
      const context = await browser.newContext({ viewport: { width: 900, height: 820 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, jsaDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[jsa-narrow] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[jsa-narrow] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Finish & Export/ }).click();
      await page.locator('.previewSheetCanvas').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, 'jsa-review-narrow-stacked.png'), fullPage: true });
      console.log('[5] JSA narrow/stacked Review screenshot saved');
      await context.close();
    }

    // ── Incident: desktop wide (side-by-side) ──
    {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, incidentDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[incident-desktop] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[incident-desktop] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue Incident Report' }).click();
      await page.getByRole('tab', { name: /^Review & Export/ }).click();
      await page.locator('.previewSheetCanvas').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, 'incident-review-desktop-wide.png'), fullPage: true });
      console.log('[6] Incident desktop-wide Review screenshot saved');

      console.log('[7] Generating real Incident PDF...');
      await page.locator('.reviewPrimaryAction button').click();
      await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.pdfReadyPanel button:has-text("Download")').click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'incident-generated.pdf'));
      console.log('    Saved -> incident-generated.pdf');
      await context.close();
    }

    // ── Incident: narrow/iPad width (stacked) ──
    {
      const context = await browser.newContext({ viewport: { width: 900, height: 820 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, incidentDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[incident-narrow] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[incident-narrow] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue Incident Report' }).click();
      await page.getByRole('tab', { name: /^Review & Export/ }).click();
      await page.locator('.previewSheetCanvas').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, 'incident-review-narrow-stacked.png'), fullPage: true });
      console.log('[8] Incident narrow/stacked Review screenshot saved');
      await context.close();
    }

    await browser.close();

    const summary = { generatedAt: new Date().toISOString(), outDir, consoleErrors, pageErrors };
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));

    if (consoleErrors.length || pageErrors.length) {
      console.error('\nFAILED: console/page errors were captured during the run.');
      process.exitCode = 1;
    }
  } finally {
    killTree(server);
  }
}

main().then(() => {
  process.exit(process.exitCode || 0);
}).catch((err) => {
  console.error('Verification script failed:', err);
  process.exitCode = 1;
});
