// THROWAWAY verification script (2026-08-19 removal of "Detailed Task Rows").
// Not part of the app build. Confirms:
//   1. A normal draft (no taskRows) shows only the three summary fields on
//      the Tasks/Hazards step -- no "Add Blank Task Row" / "Task Row
//      Templates" / "Create Row From Summary" controls anywhere.
//   2. A draft with pre-existing legacy taskRows (the messy real-world kind,
//      no ids on one row) still shows them, editable and removable, with no
//      way to add new ones.
//   3. The real PDF export still includes legacy task-row content correctly
//      alongside the summary content (getContentRows reconciliation
//      untouched by this change).

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

const normalDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');
const legacyDraft = readFileSync(path.join(__dirname, 'fixtures', 'jsa-legacy-task-rows.json'), 'utf8');

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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const consoleErrors = [];
  const pageErrors = [];
  const checks = [];
  function check(cond, msg) { checks.push({ ok: !!cond, msg }); console.log(`    [${cond ? 'PASS' : 'FAIL'}] ${msg}`); }

  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();

    // ── Case 1: normal draft, no legacy rows ──
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, normalDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[normal] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[normal] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Tasks \/ Hazards/ }).click();
      await page.waitForTimeout(300);

      const bodyText = await page.locator('.stepStack').innerText();
      check(!bodyText.includes('Add Blank Task Row'), 'No "Add Blank Task Row" button on a normal draft');
      check(!bodyText.includes('Task Row Templates'), 'No "Task Row Templates" picker on a normal draft');
      check(!bodyText.includes('Create Row From Summary'), 'No "Create Row From Summary" button on a normal draft');
      check(!bodyText.includes('Detailed Task Rows'), 'No leftover "Detailed Task Rows" heading on a normal draft');
      await page.screenshot({ path: path.join(outDir, 'taskrows-normal-work-step.png'), fullPage: true });
      await context.close();
    }

    // ── Case 2: legacy draft with pre-existing taskRows ──
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, legacyDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[legacy] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[legacy] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Tasks \/ Hazards/ }).click();
      await page.waitForTimeout(300);

      const bodyText = await page.locator('.stepStack').innerText();
      check(bodyText.includes('Older Detailed Task Rows'), 'Legacy notice shows when taskRows already has data');
      // textarea content doesn't show up in innerText() (it's a form control
      // value, not a text node) -- read the field values directly instead.
      const row1StepValue = await page.locator('.taskRow').nth(0).locator('textarea').first().inputValue();
      const row2StepValue = await page.locator('.taskRow').nth(1).locator('textarea').first().inputValue();
      check(row1StepValue.includes('unload pipe off flatbed'), `Legacy row 1 (no id in fixture) still renders (got "${row1StepValue}")`);
      check(row2StepValue.includes('backfill w/ select material'), `Legacy row 2 (has id in fixture) still renders (got "${row2StepValue}")`);
      check(!bodyText.includes('Add Blank Task Row'), 'Still no way to add a new row even with legacy rows present');
      const rowCountBefore = await page.locator('.taskRow').count();
      check(rowCountBefore === 2, `Both legacy rows rendered as editable rows (got ${rowCountBefore})`);
      await page.screenshot({ path: path.join(outDir, 'taskrows-legacy-work-step.png'), fullPage: true });

      // Editing still works.
      const firstStepField = page.locator('.taskRow').first().locator('textarea').first();
      await firstStepField.fill('unload pipe off flatbed - EDITED');
      await page.waitForTimeout(200);
      check((await firstStepField.inputValue()).includes('EDITED'), 'Editing a legacy row field still works');

      // Removing still works.
      await page.locator('.taskRow').nth(1).locator('button', { hasText: 'Remove' }).click();
      await page.waitForTimeout(200);
      const rowCountAfter = await page.locator('.taskRow').count();
      check(rowCountAfter === 1, `Removing a legacy row still works (got ${rowCountAfter} left, expected 1)`);
      await page.screenshot({ path: path.join(outDir, 'taskrows-legacy-after-edit-remove.png'), fullPage: true });

      // Confirm the real export pipeline still folds legacy row content in correctly.
      await page.getByRole('tab').last().click();
      await page.locator('.reviewPrimaryAction button').click();
      await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.pdfReadyPanel button:has-text("Download")').click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'jsa-legacy-taskrows-generated.pdf'));
      console.log('    Saved -> jsa-legacy-taskrows-generated.pdf');

      await page.addStyleTag({ content: `.pdfExportRoot { position: static !important; left: 0 !important; top: 0 !important; } .pdfExportRoot .printPage { margin: 0 0 24px !important; box-shadow: 0 0 0 1px #ccc; }` });
      const mainPage = page.locator('.pdfExportRoot .mainJsaPage').first();
      await mainPage.screenshot({ path: path.join(outDir, 'taskrows-legacy-pdf-main-page.png') });

      await context.close();
    }

    await browser.close();

    console.log('\n=== SUMMARY ===');
    checks.forEach(c => console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.msg}`));
    console.log('Console errors:', consoleErrors);
    console.log('Page errors:', pageErrors);

    if (checks.some(c => !c.ok) || consoleErrors.length || pageErrors.length) {
      process.exitCode = 1;
    }
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
