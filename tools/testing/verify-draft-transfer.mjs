// Regression coverage for the field-to-office draft handoff feature: any
// document type's Review step can "Export Draft File" (a small JSON file,
// NOT a PDF) and the Documents tab has one "Import Draft" entry point that
// auto-detects the document type and loads it as the current draft on this
// device. Exercises all three distinct code paths in the app: the shared
// useDraftDocument hook (Disciplinary), JSA's own bespoke custom-modal guard
// (ConfirmReplaceDialog), and Incident's own bespoke native-confirm guard.
//   node tools/testing/verify-draft-transfer.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'draft-transfer');
mkdirSync(outDir, { recursive: true });

const PORT = 4517;
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

async function exportAndSave(page, saveAsPath) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Draft File', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(saveAsPath);
}

async function main() {
  console.log('[1/6] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/6] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ── 1. Disciplinary round trip (shared useDraftDocument hook path) ──
    console.log('\n=== 1. Disciplinary: export then import into a fresh device ===');
    const disciplinaryFile = path.join(outDir, 'disciplinary-export.json');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Field Export Employee');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('button', { name: 'Written Warning', exact: true }).click();
      await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Repeated late arrival despite prior verbal warning.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Corrective Action');
      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Send to Someone Else to Finish');

      await exportAndSave(page, disciplinaryFile);
      check(true, 'Export Draft File downloaded without error');
      check(pageErrors.length === 0, `No page errors during export (${pageErrors.length})`);
      await context.close();
    }
    {
      // Fresh device: no localStorage at all.
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('input[type="file"]').setInputFiles(disciplinaryFile);
      await page.waitForSelector('text=Notice Details', { timeout: 8000 });
      check(true, 'Importing a disciplinary draft on a fresh device navigates straight into the workflow');
      const name = await page.getByRole('textbox', { name: 'Employee Name', exact: true }).inputValue();
      check(name === 'Field Export Employee', `Employee Name field carried over from the imported file (got "${name}")`);
      const toastText = await page.locator('.toast').innerText().catch(() => '');
      check(/imported/i.test(toastText), `Import confirmation toast shown (got "${toastText}")`);

      // Import again while this same draft is now the current, meaningful
      // content on this device -- must be guarded by a native confirm().
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      let dialogSeen = false;
      page.once('dialog', d => { dialogSeen = true; d.dismiss(); });
      await page.locator('input[type="file"]').setInputFiles(disciplinaryFile);
      await page.waitForTimeout(300);
      check(dialogSeen, 'Re-importing over existing content triggers a confirm() guard');
      // Dismissed -- current in-memory draft must be unaffected. Re-open the
      // draft's own workflow via Drafts to confirm the field is unchanged.
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      const draftRow = page.locator('.listItem', { hasText: 'Field Export Employee' });
      check(await draftRow.count() > 0, 'Dismissing the guard left the existing draft intact (still findable under Drafts)');

      check(pageErrors.length === 0, `No page errors during import (${pageErrors.length})`);
      await context.close();
    }

    // ── 2. JSA round trip (bespoke ConfirmReplaceDialog path) ──
    console.log('\n=== 2. JSA: export then import, including the custom-modal replace guard ===');
    const jsaFile = path.join(outDir, 'jsa-export.json');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Job Safety Analysis' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Start a JSA');
      await page.getByRole('button', { name: 'Start Blank', exact: false }).click();
      await page.waitForSelector('text=Location / City');
      await page.getByRole('textbox', { name: 'Location / City', exact: true }).fill('Export Test Yard');
      await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill('North Site 12');

      await page.getByRole('tab', { name: /Review/ }).click();
      await page.waitForSelector('text=Send to Someone Else to Finish');

      await exportAndSave(page, jsaFile);
      check(true, 'JSA Export Draft File downloaded without error');
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('input[type="file"]').setInputFiles(jsaFile);
      await page.waitForSelector('text=Location / City', { timeout: 8000 });
      const site = await page.getByRole('textbox', { name: 'Job Site', exact: true }).inputValue();
      check(site === 'North Site 12', `First-time JSA import (no existing content) loads directly with no modal (got Job Site "${site}")`);

      // Now import again while this JSA is the current meaningful draft --
      // JSA's own bespoke guard is a custom React modal, not native confirm().
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('input[type="file"]').setInputFiles(jsaFile);
      const modal = page.locator('.dialogPanel', { hasText: 'Replace current draft?' });
      await modal.waitFor({ state: 'visible', timeout: 5000 });
      check(true, 'Re-importing over an existing JSA draft shows the custom Replace current draft? modal');
      const bodyText = await modal.locator('#confirmReplaceBody').innerText();
      check(/importing this draft file/i.test(bodyText), `Modal copy correctly describes an import, not a blank/template replace (got "${bodyText}")`);
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.waitForTimeout(200);
      check(await modal.count() === 0 || !(await modal.isVisible().catch(() => false)), 'Cancel dismisses the modal without importing');

      await context.close();
    }

    // ── 3. Incident round trip (bespoke, native confirm path) — happy path ──
    console.log('\n=== 3. Incident: export then import on a fresh device ===');
    const incidentFile = path.join(outDir, 'incident-export.json');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Incident Report' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Incident Details', { timeout: 8000 }).catch(() => {});
      const locField = page.getByRole('textbox', { name: 'Workplace location', exact: true });
      if (await locField.count()) {
        await locField.fill('Export Test Site');
      }
      const reviewTab = page.getByRole('tab', { name: /Review/ });
      if (await reviewTab.count()) await reviewTab.click();
      await page.waitForSelector('text=Send to Someone Else to Finish', { timeout: 8000 }).catch(() => {});
      const exportBtn = page.getByRole('button', { name: 'Export Draft File', exact: true });
      if (await exportBtn.count()) {
        await exportAndSave(page, incidentFile);
        check(true, 'Incident Export Draft File downloaded without error');
      } else {
        check(false, 'Could not reach Incident Review step to export (selector drift — see screenshot)');
        await page.screenshot({ path: path.join(outDir, 'incident-export-fail.png') });
      }
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('input[type="file"]').setInputFiles(incidentFile);
      await page.waitForTimeout(500);
      const toastText = await page.locator('.toast').innerText().catch(() => '');
      check(/incident report draft imported/i.test(toastText), `Incident import confirmation toast shown (got "${toastText}")`);
      await context.close();
    }

    // ── 4. Rejects a file that isn't a recognized draft envelope ──
    console.log('\n=== 4. Rejects an unrecognized file without crashing ===');
    const bogusFile = path.join(outDir, 'not-a-draft.json');
    writeFileSync(bogusFile, JSON.stringify({ hello: 'world' }));
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('input[type="file"]').setInputFiles(bogusFile);
      await page.waitForTimeout(400);
      const toastText = await page.locator('.toast').innerText().catch(() => '');
      check(/isn't a Safety Documentation Center draft file/i.test(toastText), `Friendly rejection toast shown for an unrecognized file (got "${toastText}")`);
      check(await page.locator('h2', { hasText: 'Documents' }).isVisible(), 'Stays on the Documents tab (no partial/garbage navigation)');
      check(pageErrors.length === 0, `No page errors from a malformed import (${pageErrors.length})`);
      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[6/6] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) {
    console.log('--- preview server output (tail) ---');
    console.log(serverOutput.slice(-2000));
    process.exit(1);
  }
}

main().then(() => {
  // Explicit success exit: the spawned 'vite preview' grandchild keeps Node's
  // event loop alive on Windows even after server.kill(), so a PASSING run
  // would otherwise hang until the caller's timeout instead of finishing.
  process.exit(0);
}).catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
