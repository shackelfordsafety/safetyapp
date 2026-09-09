// Regression coverage for the Employee Medical Event form (Milestone 4 of
// the Superintendent Document Suite mission). Same lessons/pattern as the
// other verify-*.mjs scripts in this batch: standalone execution (no pipe
// to tail), getByRole textbox/exact matching, case-insensitive badge text,
// scrollIntoViewIfNeeded before drawing a signature.
//   node tools/testing/verify-medical-event.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { checkPdfContract, checkedOptions } from './lib/pdfContract.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'medical-event');
mkdirSync(outDir, { recursive: true });

const PORT = 4327;
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_KEY = 'sdc.medical.draft.v1';

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

async function drawSignature(page) {
  const canvas = page.locator('canvas.signatureCanvas').first();
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
  console.log('[1/5] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/5] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ── 1. Real UI workflow, with the "work event reported" cross-report notice ──
    console.log('\n=== 1. Real UI workflow ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      const row = page.locator('.listItem', { hasText: 'Employee Medical Event' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event & Response');

      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Jordan Blake');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('textbox', { name: 'What symptoms or concerns did the employee report?', exact: true }).fill('Employee reported dizziness and heavy sweating.');
      await page.getByRole('button', { name: 'During Work', exact: true }).click();

      const noticeBefore = await page.locator('.pdfStaleWarning', { hasText: 'work event/exposure was reported' }).count();
      check(noticeBefore === 0, 'No cross-report notice before "Yes" is selected');
      await page.getByRole('button', { name: 'Yes', exact: true }).first().click();
      await page.waitForSelector('.pdfStaleWarning:has-text("work event/exposure was reported")');
      check(true, 'Cross-report notice appears once "specific work event/exposure reported" = Yes');
      await page.getByRole('textbox', { name: 'Describe the work event / exposure reported', exact: true }).fill('Employee was working in direct sun for an extended period without shade breaks.');

      await page.getByRole('button', { name: 'Rest Period', exact: true }).click();
      // Not exact: true — this field has help text (the WHAT-EMPLOYEE-
      // REPORTED vs WHAT-SAFETY-OBSERVED distinction note), which the
      // accessible-name computation folds into the label together with the
      // field's own label text, so an exact match against the label text
      // alone never matches.
      await page.getByRole('textbox', { name: 'What did safety/supervision observe and do?' }).fill('Moved employee to shade, provided water, monitored for 30 minutes. Symptoms resolved.');

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Evaluation & Classification');
      await page.getByRole('button', { name: 'Full Duty', exact: true }).click();
      await page.getByRole('button', { name: 'Non-Occupational Medical Event', exact: true }).click();

      const sigCountBefore = await page.locator('.signaturePad button', { hasText: 'Add signature' }).count();
      check(sigCountBefore === 2, `Both signature pads present (found ${sigCountBefore})`);
      // Only the Supervisor/Safety signature is required — sign that one
      // (employee "if able" is deliberately left blank in this run to
      // exercise the optional-employee-signature path).
      await page.locator('.signaturePad', { hasText: 'Safety / Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);

      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Readiness');
      const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
      check(pendingItems === 0, `Readiness satisfied with only the required Supervisor signature (${pendingItems} pending item(s))`);

      await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.waitForTimeout(300);
      const badgeText = await page.locator('.builderHeaderBadges .badge').innerText();
      check(badgeText.trim().toLowerCase() === 'completed', `Status badge reads "Completed" (got "${badgeText.trim()}")`);

      await page.getByRole('button', { name: /Create Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = await page.locator('.pdfReadyHeadline').innerText();
      console.log(`  PDF ready: ${headline}`);
      // Paired employee-info cells + a tightened Medical Evaluation/Work
      // Status/Attachments layout (see the source-fidelity PDF rebuild) keep
      // signatures on page 1 for normal-length content.
      check(/^1 page$/.test(headline.trim()), `Normal-length content fits on 1 page (got "${headline.trim()}")`);

      const downloadPromise = page.waitForEvent('download');
      await page.locator('button', { hasText: 'Download Document' }).click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'ui-workflow-generated.pdf'));

      await page.reload({ waitUntil: 'networkidle' });
      const raw = await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY);
      const persisted = JSON.parse(raw || 'null');
      check(Boolean(persisted) && persisted.employeeName === 'Jordan Blake', 'Draft persisted under sdc.medical.draft.v1 after reload');
      check(persisted?.status === 'ready' || persisted?.status === 'completed', `Locked status persisted across reload (got "${persisted?.status}")`);
      check(persisted?.employeeSignatureData == null, 'Employee signature correctly left unset (optional "if able" field, never fabricated)');

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    // ── 2. Draft key isolation ──
    console.log('\n=== 2. Draft key isolation ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.medical.draft.v1', json), loadFixture('medical-non-occupational.json'));
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      for (const key of ['sdc.jsa.draft.v4', 'sdc.incident.draft.v1', 'sdc.discipline.draft.v1', 'sdc.uncontrolled.draft.v1']) {
        const val = await page.evaluate(k => window.localStorage.getItem(k), key);
        check(val === null, `Does not create/touch ${key}`);
      }
      await page.evaluate(() => window.localStorage.clear());
      await context.close();
    }

    // ── 3. PDF fixtures: non-occupational / work-event-reported / partial-unknown ──
    console.log('\n=== 3. PDF fixtures (page count + no clipping) ===');
    const fixtures = [
      {
        name: 'medical-non-occupational.json', label: 'non-occupational', title: 'Dale Hutto', expectMaxPages: 1,
        expectClassification: 'Non-Occupational Medical Event',
      },
      {
        name: 'medical-work-event.json', label: 'work-event-reported', title: 'Regina Poe', expectMaxPages: 1,
        expectClassification: 'Pending Review',
        // Long labels that have to survive wrapping, plus the free text.
        mustContain: [
          'Regina Poe',
          'Symptoms / Concerns (as reported by the employee)',
          'Specific Work Event/Exposure Reported?',
          'Safety / Supervisor Observations and Actions',
        ],
      },
      {
        name: 'medical-partial-unknown.json', label: 'partial-unknown', title: 'Marcus Doyle', expectMaxPages: 1,
        expectClassification: 'Pending Review',
      },
    ];
    const summary = [];
    for (const fx of fixtures) {
      console.log(`\n--- Fixture: ${fx.label} ---`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.medical.draft.v1', json), loadFixture(fx.name));
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'Today' }).first().click();
      const draftRow = page.locator('.listItem', { hasText: fx.title });
      await draftRow.getByRole('button', { name: 'Open' }).click();
      await page.waitForSelector('text=Event & Response').catch(() => {});

      await page.getByRole('button', { name: 'Next' }).click().catch(() => {});
      await page.getByRole('button', { name: 'Go to Review' }).click().catch(() => {});
      await page.waitForSelector('text=Readiness', { timeout: 5000 }).catch(() => {});
      await page.getByRole('button', { name: /Create Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = (await page.locator('.pdfReadyHeadline').innerText()).trim();
      const pageCount = parseInt(headline, 10);
      console.log(`  PDF ready: ${headline}`);
      check(Number.isFinite(pageCount) && pageCount >= 1 && pageCount <= fx.expectMaxPages, `Page count within expected range (got ${pageCount}, expected 1-${fx.expectMaxPages})`);

      // This document is drawn straight into the PDF by medicalEventPdfDraw.js,
      // so every content check below reads the downloaded artifact rather
      // than the hidden export DOM, which no longer builds it.
      const { pdf, suggestedName } = await downloadGeneratedPdf(page, path.join(outDir, `${fx.label}.pdf`));
      check(pdf.pages.length === pageCount, `App's reported page count matches the real PDF (UI said ${pageCount}, PDF has ${pdf.pages.length})`);

      const contract = await checkPdfContract(pdf, {
        label: fx.label,
        pages: [1, fx.expectMaxPages],
        draft: true,
        mustContain: [
          ...(fx.mustContain || []),
          'ATTACHMENTS',
          'Provider Note Attached', // lives under Attachments, not Medical Evaluation
          'INITIAL CLASSIFICATION',
        ],
      });
      contract.forEach(r => check(r.ok, r.label));
      check(/_DRAFT\.pdf$/.test(suggestedName), `Draft export filename carries the _DRAFT suffix (got "${suggestedName}")`);

      // Never-auto-classify assertion, read from the tick marks actually
      // printed on the page: the classification must be exactly what the
      // fixture set, never anything the app inferred on the user's behalf.
      const CLASSIFICATIONS = ['Non-Occupational Medical Event', 'Work-Related / Incident Report Required', 'Pending Review'];
      const printedClassification = checkedOptions(pdf).filter(o => CLASSIFICATIONS.includes(o));
      console.log(`  Printed Initial Classification: ${JSON.stringify(printedClassification)}`);
      check(printedClassification.length <= 1, `Exactly the fixture-specified classification prints — never more than one auto-inferred option (got ${JSON.stringify(printedClassification)})`);
      if (fx.expectClassification) {
        check(printedClassification[0] === fx.expectClassification, `Printed classification is "${fx.expectClassification}" (got ${JSON.stringify(printedClassification)})`);
      }

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);

      summary.push({ fixture: fx.label, pageCount, pdfPages: pdf.pages.length, printedClassification, suggestedName, consoleErrors: consoleErrors.length, pageErrors: pageErrors.length });
      await context.close();
    }

    // ── 4. Mobile viewport (390px) ──
    console.log('\n=== 4. Mobile viewport (390px) ===');
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.mobileNavItem', { hasText: 'Documents' }).click();
      const row = page.locator('.listItem', { hasText: 'Employee Medical Event' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event & Response');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `No horizontal overflow on phone (scrollWidth - clientWidth = ${overflow})`);
      const bottomNavHidden = await page.evaluate(() => {
        const el = document.querySelector('.mobileBottomNav');
        return !el || getComputedStyle(el).display === 'none';
      });
      check(bottomNavHidden, 'Bottom nav hidden while the builder is open');

      // Smoke-test the shared SignaturePad's native touch listener path
      // (see src/incident/SignaturePad.jsx) with real CDP touch dispatch,
      // not synthetic JS calls into the component's internals.
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Touch Smoke Test');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('textbox', { name: 'What symptoms or concerns did the employee report?', exact: true }).fill('Employee reported dizziness.');
      await page.getByRole('button', { name: 'During Work', exact: true }).click();
      await page.getByRole('button', { name: 'Yes', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Describe the work event / exposure reported', exact: true }).fill('Working in direct sun for an extended period.');
      await page.getByRole('button', { name: 'Rest Period', exact: true }).click();
      await page.getByRole('textbox', { name: 'What did safety/supervision observe and do?' }).fill('Moved employee to shade and monitored.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Evaluation & Classification');
      await page.locator('.signaturePad', { hasText: 'Safety / Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
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

    // ── 5. Mark Complete confirmation and editing lock ──
    console.log('\n=== 5. Mark Complete confirmation and editing lock ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Medical Event' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event & Response');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Finish Lock Test');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('textbox', { name: 'What symptoms or concerns did the employee report?', exact: true }).fill('Test symptoms.');
      await page.getByRole('button', { name: 'During Work', exact: true }).click();
      await page.getByRole('button', { name: 'No', exact: true }).first().click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Evaluation & Classification');
      await page.getByRole('button', { name: 'Non-Occupational Medical Event', exact: true }).click();
      await page.locator('.signaturePad', { hasText: 'Safety / Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      const canvas = page.locator('canvas.signatureCanvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 6 });
      await page.mouse.up();
      await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Readiness');

      const finishBtn = page.getByRole('button', { name: 'Mark Complete', exact: true });
      check(await finishBtn.isEnabled(), 'Mark Complete is enabled once the checklist is complete');
      await finishBtn.click();
      const dialog = page.locator('.dialogPanel', { hasText: 'Mark this document complete?' });
      check(await dialog.isVisible(), 'Confirmation dialog appears on Mark Complete click');
      await dialog.getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.waitForTimeout(300);
      const badge = await page.locator('.builderHeaderBadges .badge').innerText();
      check(badge.toLowerCase() === 'completed', `Badge reads "Completed" after confirming (got "${badge}")`);

      await page.getByRole('tab', { name: /Event & Response/ }).click();
      const nameField = page.getByRole('textbox', { name: 'Employee Name', exact: true });
      check(await nameField.isDisabled(), 'Employee Name field is disabled once finished');

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

  console.log(`\n[5/5] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
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
