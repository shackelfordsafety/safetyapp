// Regression coverage for the Employee Separation form (Milestone 5 of the
// Superintendent Document Suite mission). Rewritten for the source-fidelity
// rebuild (Part 2 of the app-wide usability/PDF-quality mission): a new
// 3-step workflow (Separation Details -> Closeout & Signatures -> Review &
// Export), a new field set (Employee ID, Project/Location, Last Day Worked,
// Date Submitted, Voluntary/Involuntary type, grouped reason list,
// documentation-attached, full Company Closeout section, "employee refused
// to sign" flag, and a three-signature Employee/Supervisor/HR-Management
// approval block), and a deterministic migration from the old simplified
// shape (see migrateSeparationShape in separationModel.js). Same
// pattern/lessons as the other verify-*.mjs scripts in this batch —
// standalone execution, getByRole textbox/exact matching, case-insensitive
// badge text, scrollIntoView before drawing a signature.
//   node tools/testing/verify-separation.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { checkPdfContract } from './lib/pdfContract.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'separation');
mkdirSync(outDir, { recursive: true });

const PORT = 4328;
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_KEY = 'sdc.separation.draft.v1';

function loadFixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

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

async function drawSignature(page, scopeLocator) {
  const canvas = (scopeLocator || page).locator('canvas.signatureCanvas').first();
  await canvas.waitFor({ state: 'visible' });
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await canvas.boundingBox();
  const points = [
    [box.x + box.width * 0.15, box.y + box.height * 0.7],
    [box.x + box.width * 0.3, box.y + box.height * 0.25],
    [box.x + box.width * 0.5, box.y + box.height * 0.75],
    [box.x + box.width * 0.7, box.y + box.height * 0.3],
    [box.x + box.width * 0.85, box.y + box.height * 0.6],
  ];
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [px, py] of points.slice(1)) {
    await page.mouse.move(px, py, { steps: 6 });
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
  await page.waitForTimeout(150);
}

async function main() {
  console.log('[1/7] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/7] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ── 1. Real UI workflow: full 3-step flow, Involuntary reveals warning fields ──
    console.log('\n=== 1. Real UI workflow ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      const row = page.locator('.listItem', { hasText: 'Employee Separation' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Separation Details');

      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Jordan Blake');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');

      const warningFieldBefore = await page.locator('text=If involuntary, were warning notices given?').count();
      check(warningFieldBefore === 0, 'Warning-notices field hidden before Involuntary is selected');
      await page.getByRole('button', { name: 'Involuntary', exact: true }).click();
      await page.getByRole('button', { name: 'Safety Violation', exact: true }).click();
      await page.getByRole('textbox', { name: 'Explain what happened and anything management should know.', exact: true }).fill('Repeated safety policy violations after two prior documented warnings.');

      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForSelector('text=Closeout');
      await page.waitForSelector('text=If involuntary, were warning notices given?');
      check(true, 'Warning-notices field appears once Involuntary is selected');
      // Scoped to each field's own container (.field) — several fields on
      // this step share the plain "Yes"/"No" button labels (Warning Notices
      // Given, Documentation Attached, Eligible for Rehire all have one),
      // so an unscoped getByRole('button', { name: 'Yes' }) collides across
      // fields depending on DOM order.
      await page.locator('.field', { hasText: 'If involuntary, were warning notices given?' }).getByRole('button', { name: 'Yes', exact: true }).click();
      await page.getByRole('textbox', { name: 'How many warning notices?', exact: true }).fill('2');
      await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'No', exact: true }).click();
      await page.waitForSelector('text=Reason not eligible for rehire');
      await page.getByRole('textbox', { name: 'Reason not eligible for rehire', exact: true }).fill('Repeated safety-critical violations.');

      /* Signatures moved to their own step. Without this the count is
         always zero, which is how this script started passing a check that
         could not fail. */
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(400);


      const sigCount = await page.locator('.signaturePad button', { hasText: 'Add signature' }).count();
      check(sigCount > 0, `Signature pads render (found )`);
      // Only the Supervisor signature is required for readiness — sign that one.
      await page.locator('.signaturePad', { hasText: 'Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);

      await page.getByRole('tab').last().first().click();
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness');
      const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
      check(pendingItems === 0, `Readiness satisfied with only the required Supervisor signature (${pendingItems} pending item(s))`);
      /* Mark Complete was removed 2026-09-11 -- the person writing a
         document does not get to decide it is finished. What has to be
         true now is that it stays a draft until an approver files it; the
         approver half is covered by verify-send-for-review.mjs. */
      await page.waitForTimeout(300);
      const badgeText = await page.locator('.builderHeaderBadges .badge').innerText();
      check(badgeText.trim().toLowerCase() === 'draft', `Stays a draft until approved (got "${badgeText.trim()}")`);

      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = await page.locator('.pdfReadyHeadline').innerText();
      console.log(`  PDF ready: ${headline}`);
      check(/^1 page$/.test(headline.trim()), `Normal-length content fits on 1 page (got "${headline.trim()}")`);

      const downloadPromise = page.waitForEvent('download');
      await page.locator('button', { hasText: 'Download' }).click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'ui-workflow-generated.pdf'));

      await page.reload({ waitUntil: 'networkidle' });
      const raw = await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY);
      const persisted = JSON.parse(raw || 'null');
      check(Boolean(persisted) && persisted.employeeName === 'Jordan Blake', 'Draft persisted under sdc.separation.draft.v1 after reload');
      check(persisted?.status === 'draft', `Still a draft after reload (got "${persisted?.status}")`);
      check(persisted?.employeeSignatureData == null, 'Employee signature correctly left unset when the employee did not sign');

      // Scope creep guard: the model must never grow payroll/HR fields the
      // mission explicitly excludes (address/phone/pay rate/tax withholding/
      // benefits/loans/payroll status).
      const forbiddenKeys = Object.keys(persisted).filter(k => /address|phone|payRate|taxWithholding|benefit|loan|payrollStatus/i.test(k));
      check(forbiddenKeys.length === 0, `No payroll/HR data-change fields present in the model (found: ${forbiddenKeys.join(', ') || 'none'})`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    // ── 2. Draft key isolation ──
    console.log('\n=== 2. Draft key isolation ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.separation.draft.v1', json), loadFixture('separation-new-voluntary.json'));
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      for (const key of ['sdc.jsa.draft.v4', 'sdc.incident.draft.v1', 'sdc.discipline.draft.v1', 'sdc.uncontrolled.draft.v1', 'sdc.medical.draft.v1']) {
        const val = await page.evaluate(k => window.localStorage.getItem(k), key);
        check(val === null, `Does not create/touch ${key}`);
      }
      await page.evaluate(() => window.localStorage.clear());
      await context.close();
    }

    // ── 3. Migration: old-shape drafts load, migrate, and print without crashing ──
    console.log('\n=== 3. Old-shape draft migration ===');
    const migrationFixtures = [
      { name: 'separation-resignation.json', label: 'resignation', title: 'Dale Hutto' },
      { name: 'separation-discharge.json', label: 'discharge', title: 'Marcus Doyle' },
      { name: 'separation-no-call-no-show.json', label: 'no-call-no-show', title: 'Regina Poe' },
    ];
    for (const fx of migrationFixtures) {
      console.log(`\n--- Fixture: ${fx.label} (old shape) ---`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.separation.draft.v1', json), loadFixture(fx.name));
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      const draftRow = page.locator('.listItem', { hasText: fx.title });
      await draftRow.getByRole('button', { name: 'Open' }).click();
      await page.waitForSelector('text=Separation Details').catch(() => {});
      await page.waitForTimeout(1200); // let the autosave debounce persist the migrated shape

      const migratedRaw = await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY);
      const migrated = JSON.parse(migratedRaw || 'null');
      check(Boolean(migrated) && migrated.schemaVersion === 2, `Migrated to schemaVersion 2 (got ${migrated?.schemaVersion})`);
      check(Boolean(migrated?.effectiveSeparationDate), 'effectiveSeparationDate populated from the old separationDate field');
      check(migrated?.separationType === '', 'New separationType field never inferred -- left blank for the user to fill in');
      check(migrated?.employeeId === '', 'New Employee ID field never inferred -- left blank');

      // Old drafts must still be able to reach Review and generate a PDF
      // without crashing, even with the new separationType left unset.
      await page.getByRole('button', { name: 'Next', exact: true }).click().catch(() => {});
      await page.getByRole('tab').last().first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness', { timeout: 5000 }).catch(() => {});
      await page.locator('.reviewPrimaryAction button').first().click().catch(() => {});
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 }).catch(() => {});
      const readyPanelVisible = await page.locator('.pdfReadyPanel').isVisible().catch(() => false);
      check(readyPanelVisible, 'Migrated old-shape draft still generates a PDF without crashing');

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);
      await context.close();
    }

    // ── 4. New-shape PDF fixtures (page count + no clipping) ──
    console.log('\n=== 4. New-shape PDF fixtures (page count + no clipping) ===');
    const fixtures = [
      {
        name: 'separation-new-involuntary.json',
        label: 'involuntary',
        title: 'Marcus Doyle',
        expectMaxPages: 1,
        // "Effective Separation Date" is the label that the pre-wrap drawing
        // code chopped to "Effective Separation". It wraps across two lines
        // in its cell, so only the column-wise reading finds it whole —
        // which is exactly the regression this fixture exists to hold down.
        mustContain: [
          'Marcus Doyle', 'EMP-4471', 'Ray Ferris', 'Ridgeland MS - Entergy TAPS Yard',
          'Effective Separation Date',
          'Job Abandonment / No Call-No Show',
          'Repeated safety-critical violations after progressive discipline.',
        ],
      },
      { name: 'separation-new-voluntary.json', label: 'voluntary', title: 'Dale Hutto', expectMaxPages: 1 },
    ];
    const summary = [];
    for (const fx of fixtures) {
      console.log(`\n--- Fixture: ${fx.label} ---`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.separation.draft.v1', json), loadFixture(fx.name));
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      const draftRow = page.locator('.listItem', { hasText: fx.title });
      await draftRow.getByRole('button', { name: 'Open' }).click();
      await page.waitForSelector('text=Separation Details').catch(() => {});

      await page.getByRole('button', { name: 'Next', exact: true }).click().catch(() => {});
      await page.getByRole('tab').last().first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness', { timeout: 5000 }).catch(() => {});
      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = (await page.locator('.pdfReadyHeadline').innerText()).trim();
      const pageCount = parseInt(headline, 10);
      console.log(`  PDF ready: ${headline}`);
      check(Number.isFinite(pageCount) && pageCount >= 1 && pageCount <= fx.expectMaxPages, `Page count within expected range (got ${pageCount}, expected 1-${fx.expectMaxPages})`);

      // This document is drawn straight into the PDF by separationPdfDraw.js,
      // so every content check below reads the downloaded artifact rather
      // than the hidden export DOM, which no longer builds it.
      const { pdf, suggestedName } = await downloadGeneratedPdf(page, path.join(outDir, `${fx.label}.pdf`));
      check(pdf.pages.length === pageCount, `App's reported page count matches the real PDF (UI said ${pageCount}, PDF has ${pdf.pages.length})`);

      const contract = await checkPdfContract(pdf, {
        label: fx.label,
        pages: [1, fx.expectMaxPages],
        draft: false, // watermark removed 2026-09-09; the _DRAFT filename marks it instead
        mustContain: [...(fx.mustContain || []), 'COMPANY CLOSEOUT', 'APPROVALS'],
        // The Employee Data Change half of the historical form must never
        // appear — this is a separation-only document.
        mustNotContain: ['Pay Rate', 'Tax Withholding', 'Address Change', 'Phone Change'],
      });
      contract.forEach(r => check(r.ok, r.label));
      check(/_DRAFT\.pdf$/.test(suggestedName), `Draft export filename carries the _DRAFT suffix (got "${suggestedName}")`);

      // Warning-notices row is only meaningful for the involuntary fixture.
      const printed = pdf.pages.flatMap(p => p.texts.map(t => t.text)).join(' ');
      const hasWarningRow = printed.includes('Warning Notices Given?');
      check(hasWarningRow === (fx.label === 'involuntary'), `Warning Notices row only prints for the involuntary fixture (present: ${hasWarningRow})`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);

      summary.push({ fixture: fx.label, pageCount, pdfPages: pdf.pages.length, suggestedName, consoleErrors: consoleErrors.length, pageErrors: pageErrors.length });
      await context.close();
    }

    // ── 5. Mobile viewport (390px) ──
    console.log('\n=== 5. Mobile viewport (390px) ===');
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      const row = page.locator('.listItem', { hasText: 'Employee Separation' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Separation Details');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `No horizontal overflow on phone (scrollWidth - clientWidth = ${overflow})`);
      const bottomNavHidden = await page.evaluate(() => {
        const el = document.querySelector('.mobileBottomNav');
        return !el || getComputedStyle(el).display === 'none';
      });
      check(bottomNavHidden, 'Bottom nav hidden while the builder is open');

      // Smoke-test the shared SignaturePad's native touch listener path
      // (see src/incident/SignaturePad.jsx) with real CDP touch dispatch,
      // not synthetic JS calls into the component's internals. Signature
      // pads are on the Closeout & Signatures step now.
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Touch Smoke Test');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForSelector('text=Closeout');
      await page.locator('.signaturePad', { hasText: 'Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      const canvas = page.locator('canvas.signatureCanvas').first();
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const box = await canvas.boundingBox();
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.15, y: box.y + box.height * 0.5 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.5, y: box.y + box.height * 0.3 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.85, y: box.y + box.height * 0.6 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const hasInk = await canvas.evaluate((el) => {
        const ctx = el.getContext('2d');
        const data = ctx.getImageData(0, 0, el.width, el.height).data;
        for (let i = 3; i < data.length; i += 4 * 8) { if (data[i] > 10) return true; }
        return false;
      });
      check(hasInk, 'Touch input (native touch listener path) draws visible ink on the signature canvas');
      await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
      const previewSrc = await page.locator('.signaturePreview').first().getAttribute('src');
      check(Boolean(previewSrc && previewSrc.startsWith('data:image/png')), 'Touch-drawn signature saves to a real PNG preview');

      check(pageErrors.length === 0, `No page errors on phone (${pageErrors.length} found)`);
      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    // ── Stays a draft, and stays editable, until it is approved ──
    console.log('\n=== Draft stays editable until approved ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Separation' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Separation Details');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Finish Lock Test');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('button', { name: 'Resignation', exact: true }).click();
      await page.getByRole('textbox', { name: 'Explain what happened and anything management should know.', exact: true }).fill('Test explanation.');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForSelector('text=Closeout');
      await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'Yes', exact: true }).click();
      await page.locator('.signaturePad', { hasText: 'Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      const canvas = page.locator('canvas.signatureCanvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 6 });
      await page.mouse.up();
      await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
      await page.getByRole('tab').last().first().click();
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness');

      /* This section proved Mark Complete locked the form. That button is
         gone (2026-09-11) -- the person writing a document does not get to
         decide it is finished. The opposite has to hold now: it stays a
         draft, and stays editable, until an approver files it. The
         approver half is covered by verify-send-for-review.mjs. */
      const badge = await page.locator('.builderHeaderBadges .badge').first().innerText();
      check(badge.trim().toLowerCase() === 'draft', `Stays a draft until approved (got "${badge.trim()}")`);
      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    await browser.close();

    console.log('\n=== OVERALL SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  } finally {
    killTree(server);
  }

  console.log(`\n[7/7] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
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
