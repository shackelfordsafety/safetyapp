// Regression coverage for the Uncontrolled Event Report (Milestone 3 of the
// Superintendent Document Suite mission). Same pattern/lessons as
// verify-disciplinary.mjs: run standalone (no pipe to tail), getByRole
// textbox/exact matching to avoid stepper-tab aria-label collisions, badge
// text compared case-insensitively (text-transform:uppercase in CSS).
//   node tools/testing/verify-uncontrolled-event.mjs

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
const outDir = path.join(__dirname, 'output', 'uncontrolled-event');
mkdirSync(outDir, { recursive: true });

const PORT = 4326;
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_KEY = 'sdc.uncontrolled.draft.v1';

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

    // ── 1. Real UI workflow: fill, classify, sign, autosave, reload, generate PDF ──
    console.log('\n=== 1. Real UI workflow ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      const row = page.locator('.listItem', { hasText: 'Uncontrolled Event Report' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event Info & Classification');

      await page.getByRole('textbox', { name: 'Workplace Location / Project', exact: true }).fill('Ridgeland, MS Test Site');
      await page.getByRole('button', { name: 'Weather / Natural (wind, lightning, flood, heat/cold)', exact: true }).click();
      await page.getByRole('button', { name: 'Near Miss (no damage/injury)', exact: true }).click();

      const injuryNotice = await page.locator('.pdfStaleWarning', { hasText: 'Injury/Illness' }).count();
      check(injuryNotice === 0, 'No injury cross-report notice shown when Injury/Illness not selected');
      await page.getByRole('button', { name: 'Injury / Illness (record separately)', exact: true }).click();
      await page.waitForSelector('.pdfStaleWarning:has-text("Injury/Illness")');
      check(true, 'Injury cross-report notice appears once Injury/Illness outcome is selected');
      await page.getByRole('button', { name: 'Injury / Illness (record separately)', exact: true }).click(); // deselect for the rest of this run

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Narrative & Notifications');
      await page.getByRole('textbox', { name: 'What Happened / Brief Summary / Timeline', exact: true }).fill('A ladder was found improperly footed near the equipment staging area during a routine walk-through.');
      await page.getByRole('textbox', { name: 'What did you do right after this happened?', exact: true }).fill('Ladder was removed from service and crew was reminded of proper footing requirements at the next tailgate.');
      await page.getByRole('button', { name: 'Supervisor', exact: true }).click();
      await page.getByRole('textbox', { name: 'Reported By — Name', exact: true }).fill('Jordan Blake');

      /* Signatures moved to their own step. Without this the count is
         always zero, which is how this script started passing a check that
         could not fail. */
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(400);


      const sigCount = await page.locator('.signaturePad button', { hasText: 'Add signature' }).count();
      check(sigCount > 0, `Signature pads render (found )`);
      for (let i = 0; i < sigCount; i += 1) {
        await page.locator('.signaturePad button', { hasText: 'Add signature' }).first().click();
        const canvas = page.locator('canvas.signatureCanvas').first();
        await canvas.waitFor({ state: 'visible' });
        // This form's second signature pad sits further down the page than
        // Disciplinary's (separate Reported By / Supervisor Review sections
        // rather than one shared Signatures block) — without scrolling it
        // fully into view first, synthetic mouse coordinates for the lower
        // part of the canvas land beyond the 900px viewport and never
        // register as a stroke, so the signature silently fails to save.
        await canvas.scrollIntoViewIfNeeded();
        // SignaturePad sizes its canvas from a post-mount effect (real
        // container width, see SignaturePad.jsx) — a short settle avoids
        // drawing on a canvas that hasn't been sized yet.
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
      const remainingAdd = await page.locator('.signaturePad button', { hasText: 'Add signature' }).count();
      check(remainingAdd === 0, `Both signatures captured (${remainingAdd} "Add signature" button(s) remain)`);

      await page.getByRole('tab', { name: /Submit/i }).first().click();
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness');
      const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
      check(pendingItems === 0, `Readiness checklist fully satisfied (${pendingItems} pending item(s))`);
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
      // The two-column layout (Event Classification | Outcome/Impact,
      // Immediate Actions | Notifications/Attachments — see the source-
      // fidelity PDF rebuild) halves the vertical space a typical report
      // needs, so normal-length content now fits on 1 page (see Section 3's
      // fixture tests for the same expectation).
      check(/^1 page$/.test(headline.trim()), `Normal-length content fits on 1 page (got "${headline.trim()}")`);

      const downloadPromise = page.waitForEvent('download');
      await page.locator('button', { hasText: 'Download' }).click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'ui-workflow-generated.pdf'));

      await page.reload({ waitUntil: 'networkidle' });
      const raw = await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY);
      const persisted = JSON.parse(raw || 'null');
      check(Boolean(persisted) && persisted.workplaceLocation === 'Ridgeland, MS Test Site', 'Draft persisted under sdc.uncontrolled.draft.v1 after reload');
      check(persisted?.status === 'draft', `Still a draft after reload (got "${persisted?.status}")`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    // ── 2. Draft key isolation ──
    console.log('\n=== 2. Draft key isolation ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.uncontrolled.draft.v1', json), loadFixture('uncontrolled-near-miss.json'));
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      const jsaUntouched = await page.evaluate(() => window.localStorage.getItem('sdc.jsa.draft.v4'));
      check(jsaUntouched === null, 'Does not create/touch sdc.jsa.draft.v4');
      const incidentUntouched = await page.evaluate(() => window.localStorage.getItem('sdc.incident.draft.v1'));
      check(incidentUntouched === null, 'Does not create/touch sdc.incident.draft.v1');
      const discUntouched = await page.evaluate(() => window.localStorage.getItem('sdc.discipline.draft.v1'));
      check(discUntouched === null, 'Does not create/touch sdc.discipline.draft.v1');
      await page.evaluate(() => window.localStorage.clear());
      await context.close();
    }

    // ── 2b. Renamed options must survive in an already-saved draft ──
    //
    // Restoring the source form's parentheticals ("Near Miss" ->
    // "Near Miss (no damage/injury)") changes the string a draft has already
    // stored. Without migrateUncontrolledEventShape() the old value stops
    // matching any option, so the box prints empty and the superintendent's
    // answer is gone with nothing to show it ever existed.
    console.log('\n=== 2b. Pre-rename draft keeps its selections ===');
    {
      const legacy = JSON.stringify({
        ...JSON.parse(loadFixture('uncontrolled-spill.json')),
        status: 'draft',
        eventClassifications: ['Weather / Natural', 'Site Condition Change'],
        eventOutcomes: ['Near Miss', 'Injury / Illness'],
      });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.uncontrolled.draft.v1', json), legacy);
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      await page.locator('.listItem', { hasText: 'Brandon' }).getByRole('button', { name: 'Open' }).click();
      await page.getByRole('button', { name: 'Next' }).click().catch(() => {});
      await page.getByRole('tab', { name: /Submit/i }).first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness', { timeout: 5000 }).catch(() => {});
      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { pdf } = await downloadGeneratedPdf(page, path.join(outDir, 'legacy-option-names.pdf'));
      const ticked = checkedOptions(pdf);
      for (const expected of [
        'Weather / Natural (wind, lightning, flood, heat/cold)',
        'Site Condition Change (ground, erosion, collapse)',
        'Near Miss (no damage/injury)',
        'Injury / Illness (record separately)',
      ]) {
        check(ticked.includes(expected), `Pre-rename draft still prints "${expected}" ticked`);
      }
      await page.evaluate(() => window.localStorage.clear());
      await context.close();
    }

    // ── 3. PDF fixtures: near miss / spill / long timeline ──
    console.log('\n=== 3. PDF fixtures (page count + no clipping) ===');
    const fixtures = [
      { name: 'uncontrolled-near-miss.json', label: 'near-miss', expectMaxPages: 1 },
      {
        name: 'uncontrolled-spill.json',
        label: 'spill',
        expectMaxPages: 1,
        // Long option and section labels that have to survive wrapping in
        // the narrow two-column blocks, plus the user's own free text.
        mustContain: [
          'Brandon, MS — Rankin Co. Yard', 'Casey Renn', 'Ray Ferris',
          'Equipment / Mechanical Failure (not misuse)',
          'Medical Event / Illness (non-occupational)',
          'WHAT HAPPENED / BRIEF SUMMARY / TIMELINE',
          'REPORTED BY / SUPERVISOR REVIEW',
          'A hydraulic hose on the excavator ruptured during operation',
        ],
      },
      // Deliberately pathological (no real report would have a timeline
      // this long) — the important thing is safe, uncapped-but-unclipped
      // pagination, not hitting a specific page count.
      { name: 'uncontrolled-long-timeline.json', label: 'long-timeline', expectMaxPages: 8 },
    ];
    const summary = [];
    for (const fx of fixtures) {
      console.log(`\n--- Fixture: ${fx.label} ---`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.uncontrolled.draft.v1', json), loadFixture(fx.name));
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      const draftRow = page.locator('.listItem', { hasText: 'Ridgeland, MS' }).or(page.locator('.listItem', { hasText: 'Brandon, MS' }));
      await draftRow.first().getByRole('button', { name: 'Open' }).click();
      await page.waitForSelector('text=Event Info & Classification').catch(() => {});

      await page.getByRole('button', { name: 'Next' }).click().catch(() => {});
      await page.getByRole('tab', { name: /Submit/i }).first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness', { timeout: 5000 }).catch(() => {});
      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = (await page.locator('.pdfReadyHeadline').innerText()).trim();
      const pageCount = parseInt(headline, 10);
      console.log(`  PDF ready: ${headline}`);
      check(Number.isFinite(pageCount) && pageCount >= 1 && pageCount <= fx.expectMaxPages, `Page count within expected range (got ${pageCount}, expected 1-${fx.expectMaxPages})`);

      // This document is drawn straight into the PDF by
      // uncontrolledEventPdfDraw.js, so every content check below reads the
      // downloaded artifact rather than the hidden export DOM, which no
      // longer builds it.
      const { pdf, suggestedName } = await downloadGeneratedPdf(page, path.join(outDir, `${fx.label}.pdf`));
      check(pdf.pages.length === pageCount, `App's reported page count matches the real PDF (UI said ${pageCount}, PDF has ${pdf.pages.length})`);

      const contract = await checkPdfContract(pdf, {
        label: fx.label,
        pages: [1, fx.expectMaxPages],
        draft: false, // watermark removed 2026-09-09; the _DRAFT filename marks it instead
        mustContain: fx.mustContain || [],
      });
      contract.forEach(r => check(r.ok, r.label));
      check(/_DRAFT\.pdf$/.test(suggestedName), `Draft export filename carries the _DRAFT suffix (got "${suggestedName}")`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);

      summary.push({ fixture: fx.label, pageCount, pdfPages: pdf.pages.length, suggestedName, consoleErrors: consoleErrors.length, pageErrors: pageErrors.length });
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
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      const row = page.locator('.listItem', { hasText: 'Uncontrolled Event Report' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event Info & Classification');
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
      await page.getByRole('textbox', { name: 'Workplace Location / Project', exact: true }).fill('Touch Smoke Test Site');
      await page.getByRole('button', { name: 'Weather / Natural (wind, lightning, flood, heat/cold)', exact: true }).click();
      await page.getByRole('button', { name: 'Near Miss (no damage/injury)', exact: true }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Narrative & Notifications');
      await page.locator('.signaturePad button', { hasText: 'Add signature' }).first().click();
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
      await page.locator('.listItem', { hasText: 'Uncontrolled Event Report' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event Info & Classification');
      await page.getByRole('textbox', { name: 'Workplace Location / Project', exact: true }).fill('Finish Lock Test Site');
      await page.getByRole('button', { name: 'Weather / Natural (wind, lightning, flood, heat/cold)', exact: true }).click();
      await page.getByRole('button', { name: 'Near Miss (no damage/injury)', exact: true }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Narrative & Notifications');
      await page.getByRole('textbox', { name: 'What Happened / Brief Summary / Timeline', exact: true }).fill('Test timeline.');
      await page.getByRole('textbox', { name: 'Reported By — Name', exact: true }).fill('Finish Lock Test');
      await page.locator('.signaturePad button', { hasText: 'Add signature' }).first().click();
      const canvas = page.locator('canvas.signatureCanvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 6 });
      await page.mouse.up();
      await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
      await page.getByRole('tab', { name: /Submit/i }).first().click();
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
