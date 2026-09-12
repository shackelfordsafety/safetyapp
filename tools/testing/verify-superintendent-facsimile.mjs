// TEMPORARY verification script (2026-08-13 C2 redesign phase 3b: Review
// facsimile for Disciplinary/Separation/Medical Event/Uncontrolled Event).
//
// Not part of the application build or bundle. For each of the 4 documents:
//   1. Screenshot the Review step at desktop width (side-by-side "What Will
//      Print" facsimile) and iPad/narrow width (stacked below).
//   2. Generate + download a real PDF, to confirm the PDF export pipeline
//      (untouched by this change -- it still calls the original drawXPdf
//      functions) still works and to compare fidelity against the facsimile.
//
// node tools/testing/verify-superintendent-facsimile.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'superintendent-facsimile');
mkdirSync(outDir, { recursive: true });

const DOCS = [
  { key: 'disciplinary', storageKey: 'sdc.discipline.draft.v1', fixture: 'disciplinary-stress-messy.json', listItemText: 'Employee Disciplinary Notice', formTitle: 'Disciplinary' },
  { key: 'separation', storageKey: 'sdc.separation.draft.v1', fixture: 'separation-stress-allsigs.json', listItemText: 'Employee Separation', formTitle: 'Separation' },
  { key: 'medicalEvent', storageKey: 'sdc.medical.draft.v1', fixture: 'medical-work-event.json', listItemText: 'Employee Medical Event', formTitle: 'Medical Event' },
  { key: 'uncontrolledEvent', storageKey: 'sdc.uncontrolled.draft.v1', fixture: 'uncontrolled-long-timeline.json', listItemText: 'Uncontrolled Event Report', formTitle: 'Uncontrolled Event' },
];

const PORT = 4322;
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

async function goToReview(page) {
  await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
  await page.locator('.listItem').first().getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click().catch(() => {});
  await page.getByRole('tab').last().first().click().catch(() => {});
  await page.locator('.docFacsimile').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
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

    for (const doc of DOCS) {
      const fixtureJson = readFileSync(path.join(__dirname, 'fixtures', doc.fixture), 'utf8');
      JSON.parse(fixtureJson);

      // ── desktop wide (side-by-side) + PDF generation ──
      {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        await context.addInitScript(({ json, key }) => { window.localStorage.setItem(key, json); }, { json: fixtureJson, key: doc.storageKey });
        const page = await context.newPage();
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${doc.key}-desktop] ${m.text()}`); });
        page.on('pageerror', (e) => pageErrors.push(`[${doc.key}-desktop] ${e.message}`));
        await page.goto(BASE_URL, { waitUntil: 'networkidle' });
        await goToReview(page);
        await page.screenshot({ path: path.join(outDir, `${doc.key}-review-desktop-wide.png`), fullPage: true });
        console.log(`[3] ${doc.key} desktop-wide Review screenshot saved`);

        console.log(`[4] Generating real ${doc.key} PDF...`);
        await page.locator('.reviewPrimaryAction button').first().click();
        await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
        const downloadPromise = page.waitForEvent('download');
        await page.locator('.pdfReadyPanel button:has-text("Download")').click();
        const download = await downloadPromise;
        await download.saveAs(path.join(outDir, `${doc.key}-generated.pdf`));
        console.log(`    Saved -> ${doc.key}-generated.pdf`);
        await context.close();
      }

      // ── narrow/iPad width (stacked) ──
      {
        const context = await browser.newContext({ viewport: { width: 900, height: 820 } });
        await context.addInitScript(({ json, key }) => { window.localStorage.setItem(key, json); }, { json: fixtureJson, key: doc.storageKey });
        const page = await context.newPage();
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${doc.key}-narrow] ${m.text()}`); });
        page.on('pageerror', (e) => pageErrors.push(`[${doc.key}-narrow] ${e.message}`));
        await page.goto(BASE_URL, { waitUntil: 'networkidle' });
        await goToReview(page);
        await page.screenshot({ path: path.join(outDir, `${doc.key}-review-narrow-stacked.png`), fullPage: true });
        console.log(`[5] ${doc.key} narrow/stacked Review screenshot saved`);
        await context.close();
      }
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
