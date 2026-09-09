// TEMPORARY verification script (2026-08-13 stepNav mobile-overlap fix).
//
// Reproduces the bug Fonzo hit on real iPhone: .stepNav's mobile
// `position: static` override sat earlier in styles.css than the base
// `position: sticky` rule, so same-specificity source order meant sticky
// always won -- the step list stayed pinned on top of the page while
// scrolling on any narrow/touch viewport, on every document (StepNav is
// shared across all 6). Emulates a real iPhone viewport + touch, scrolls
// partway down a tall Review step, and screenshots to confirm the step
// list is no longer overlapping content.
//
// node tools/testing/verify-stepnav-mobile-fix.mjs

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'stepnav-mobile-fix');
mkdirSync(outDir, { recursive: true });

const PORT = 4323;
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
    const iphone = devices['iPhone 13'];

    // ── Separation (the doc Fonzo tested), real iPhone viewport ──
    {
      const fixtureJson = readFileSync(path.join(__dirname, 'fixtures', 'separation-stress-allsigs.json'), 'utf8');
      const context = await browser.newContext({ ...iphone });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.separation.draft.v1', json); }, fixtureJson);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[separation] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[separation] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.mobileNavItem', { hasText: 'Today' }).first().click();
      await page.locator('.listItem').first().getByRole('button', { name: 'Open' }).click();
      await page.getByRole('button', { name: 'Next', exact: true }).click().catch(() => {});
      await page.getByRole('button', { name: 'Go to Review' }).click().catch(() => {});
      await page.locator('.docFacsimile').waitFor({ state: 'visible', timeout: 10000 });
      await page.screenshot({ path: path.join(outDir, 'separation-review-top.png') });
      // Scroll roughly to where Fonzo's screenshots show the overlap (past
      // the step list, mid-checklist).
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, 'separation-review-scrolled-500.png') });
      await page.evaluate(() => window.scrollTo(0, 1000));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, 'separation-review-scrolled-1000.png') });
      await context.close();
    }

    // ── JSA, same viewport, different doc to confirm the shared fix ──
    {
      const fixtureJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-stress-messy-continuation.json'), 'utf8');
      const context = await browser.newContext({ ...iphone });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, fixtureJson);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[jsa] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[jsa] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Finish & Export/ }).click();
      await page.locator('.previewSheetCanvas').waitFor({ state: 'visible', timeout: 10000 });
      await page.evaluate(() => window.scrollTo(0, 600));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, 'jsa-review-scrolled-600.png') });
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
