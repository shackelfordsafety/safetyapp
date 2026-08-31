// Verifies the 2026-08-31 Separation form cleanup (Fonzo's real complaints
// off a live screenshot):
//   1. Employee ID and "Documentation attached?" removed from the UI and
//      the printed PDF (kept harmlessly in the data model for old drafts).
//   2. The single-pill "tap to flip" Yes/No pattern (Final Timesheet
//      Submitted, Expenses/Receipts Resolved) replaced with the standard
//      two-button Yes/No toggle already used elsewhere on this step.
//   3. The shared Finish & Export panel's "Mark Complete" button replaced
//      with an "Is this document complete?" Yes/No toggle, and "Send to
//      Someone Else to Finish" shrunk from its own full card to a compact
//      secondary action (this part of FormPrimitives.jsx is shared by
//      Disciplinary/Separation/Medical Event/Uncontrolled Event, so fixing
//      it here fixes it everywhere at once).
// Drives the real UI + real PDF export via Playwright.
//
// node tools/testing/verify-separation-ui-cleanup.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'separation-ui-cleanup');
mkdirSync(outDir, { recursive: true });

const fixture = readFileSync(path.join(__dirname, 'fixtures', 'separation-stress-allsigs.json'), 'utf8');
const STORAGE_KEY = 'sdc.separation.draft.v1';
const PORT = 4334;
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(([key, json]) => { window.localStorage.setItem(key, json); }, [STORAGE_KEY, fixture]);
    const page = await context.newPage();
    const consoleErrors = []; const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Drafts', exact: false }).first().click();
    const row = page.locator('.listItem', { hasText: 'DASDJK' });
    await row.getByRole('button', { name: 'Open Draft', exact: true }).click();
    await page.waitForSelector('text=Separation Details');

    console.log('[3/6] Separation Details step...');
    check((await page.getByText('Employee ID', { exact: true }).count()) === 0, 'Employee ID field is gone');
    await page.screenshot({ path: path.join(outDir, '1-details.png'), fullPage: true });

    await page.getByRole('tab', { name: /^Closeout/ }).click();
    console.log('[4/6] Closeout step...');
    check((await page.getByText('Documentation attached?', { exact: true }).count()) === 0, 'Documentation attached? field is gone');
    const timesheetField = page.locator('.field', { hasText: 'Final timesheet submitted' });
    const timesheetButtons = await timesheetField.getByRole('button').count();
    check(timesheetButtons === 2, `Final timesheet submitted renders 2 buttons (Yes/No), got ${timesheetButtons}`);
    const expensesField = page.locator('.field', { hasText: 'Expenses / receipts resolved' });
    const expensesButtons = await expensesField.getByRole('button').count();
    check(expensesButtons === 2, `Expenses / receipts resolved renders 2 buttons (Yes/No), got ${expensesButtons}`);
    await timesheetField.getByRole('button', { name: 'Yes', exact: true }).click();
    await expensesField.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.screenshot({ path: path.join(outDir, '2-closeout.png'), fullPage: true });

    // Fill the two readiness gaps this fixture's messy data left open.
    await page.getByRole('tab', { name: /^Separation Details/ }).click();
    await page.getByRole('textbox', { name: 'Effective Separation Date', exact: true }).fill('2026-08-31');

    await page.getByRole('tab', { name: /^Finish & Export/ }).click();
    console.log('[5/6] Finish & Export step...');
    const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
    check(pendingItems === 0, `Readiness checklist fully satisfied (${pendingItems} pending item(s))`);
    check((await page.getByRole('button', { name: 'Mark Complete', exact: true }).count()) === 0, 'Old "Mark Complete" button is gone');
    const completeField = page.locator('.field', { hasText: 'Is this document complete?' });
    await completeField.waitFor({ state: 'visible' });
    check(true, '"Is this document complete?" toggle is present');
    check((await page.locator('.cardHeader', { hasText: 'Send to Someone Else to Finish' }).count()) === 0, 'Send to Someone Else to Finish no longer has its own card header');
    const sendBtn = page.getByRole('button', { name: 'Send to Someone Else to Finish', exact: true });
    check(await sendBtn.isVisible(), 'Send to Someone Else to Finish is now a compact secondary action');
    await page.screenshot({ path: path.join(outDir, '3-export-before-complete.png'), fullPage: true });

    await completeField.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
    await page.waitForTimeout(300);
    const badgeText = await page.locator('.builderHeaderBadges .badge').innerText();
    check(badgeText.trim().toLowerCase() === 'completed', `Status badge reads "Completed" after confirming (got "${badgeText.trim()}")`);
    await page.screenshot({ path: path.join(outDir, '4-export-after-complete.png'), fullPage: true });

    console.log('[6/6] Generating the real PDF...');
    await page.getByRole('button', { name: /Create Document/ }).click();
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
    const { savedTo } = await downloadGeneratedPdf(page, path.join(outDir, 'separation-cleanup.pdf'));
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
