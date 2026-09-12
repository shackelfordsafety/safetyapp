// Regression coverage for the Employee Disciplinary Notice (Milestone 2 of
// the Superintendent Document Suite mission). Same pattern as the existing
// verify-*.mjs scripts: `vite preview` serving the production build, driven
// with real Playwright interaction (typing, signature drawing) plus direct
// localStorage seeding for the PDF-content fixture cases. Run standalone
// (no pipe to tail — see the mobile UX session's postmortem on why piping
// this kind of script deadlocks stdout):
//   node tools/testing/verify-disciplinary.mjs

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
const outDir = path.join(__dirname, 'output', 'disciplinary');
mkdirSync(outDir, { recursive: true });

const PORT = 4325;
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_KEY = 'sdc.discipline.draft.v1';

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

    // ── 1. Real UI workflow: fill, sign, autosave, reload, generate PDF ──
    console.log('\n=== 1. Real UI workflow ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.waitForSelector('text=Employee Disciplinary Notice');
      const row = page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');

      // getByRole('textbox', ...) rather than getByLabel — the stepper rail's
      // own tab buttons carry an aria-label like "Corrective Action: Needs
      // Info", which substring-collides with getByLabel's default matching
      // against a same-named field; scoping to the textbox/input role avoids
      // matching a role="tab" element entirely.
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Jordan Blake');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('textbox', { name: 'Position', exact: true }).fill('Laborer');
      await page.getByRole('button', { name: 'Written Warning', exact: true }).click();
      await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Employee failed to wear required fall protection while working at height on the scaffold.');

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Corrective Action');
      await page.getByRole('textbox', { name: 'What must the employee do to correct this?', exact: true }).fill('Employee must wear fall protection at all times above six feet, verified daily by the foreman.');
      await page.getByRole('textbox', { name: 'What will the company do?', exact: true }).fill('The company will retrain the employee on fall protection requirements.');
      await page.getByRole('textbox', { name: "What happens if this isn't corrected?", exact: true }).fill('Further violations will result in suspension or termination.');

      /* Signatures live on their own step now, and there are THREE of
         them -- manager, employee, and a witness who was in the room
         (Fonzo, 2026-09-11: a clerk can witness a firing). The old script
         expected two, on this step, and so found none. */
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(400);

      // Draw every signature with real pointer input. Button text is scoped
      // to .signaturePadActions/.signaturePad with an exact "Save" match —
      // the builder header's own "Save Now" button also contains the
      // substring "Save", which a loose hasText match would collide with.
      const sigButtons = page.locator('.signaturePad button', { hasText: 'Add signature' });
      const sigCount = await sigButtons.count();
      check(sigCount === 3, `Manager, employee and witness pads all present (found ${sigCount})`);
      for (let i = 0; i < sigCount; i += 1) {
        await page.locator('.signaturePad button', { hasText: 'Add signature' }).first().click();
        const canvas = page.locator('canvas.signatureCanvas').first();
        // A lower signature pad can sit beyond the viewport, and synthetic
        // mouse coordinates below the viewport bottom never register as a
        // stroke (see the Uncontrolled Event regression's own postmortem).
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 20, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 8 });
        await page.mouse.up();
        await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
      }
      const remainingAdd = await page.locator('.signaturePad button', { hasText: 'Add signature' }).count();
      check(sigCount > 0 && remainingAdd === 0, 'Every signature captured (no "Add signature" buttons remain)');

      /* From the signatures step the way on is the step nav -- Review is a
         step like any other, not a footer button. */
      await page.getByRole('tab', { name: /Review/i }).first().click();
      await page.waitForSelector('text=Readiness');

      const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
      check(pendingItems === 0, `Readiness checklist fully satisfied (${pendingItems} pending item(s))`);

      /* Review (the checklist) and Submit (where it leaves your hands) are
         two different steps -- Submit is the one that used to be called
         Finish & Export. */
      await page.getByRole('tab', { name: /Submit/i }).first().click();
      await page.waitForTimeout(400);

      /* Marking a document complete yourself is gone, 2026-09-11: taking
         the DRAFT watermark off something nobody had approved was the
         author's call, and it should never have been. Completing is the
         approver's job now, and that whole chain has its own tests
         (verify-send-for-review.mjs, simulate-review-chain.mjs). What is
         still this script's business is that the form stays a draft. */
      const badgeText = await page.locator('.builderHeaderBadges .badge').first().innerText();
      check(badgeText.trim().toLowerCase() === 'draft', `Stays a draft until somebody approves it (got "${badgeText.trim()}")`);

      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = await page.locator('.pdfReadyHeadline').innerText();
      console.log(`  PDF ready: ${headline}`);
      /* Two pages now, not one: the witness signature block Fonzo asked
         for on 2026-09-11 pushes the signature section onto its own page.
         Expected, not a layout fault. */
      check(/^2 pages$/.test(headline.trim()), `Notice plus its signature page (got "${headline.trim()}")`);

      const { pdf, suggestedName, savedTo } = await downloadGeneratedPdf(page, path.join(outDir, 'ui-workflow-generated.pdf'));
      console.log('  Saved PDF ->', savedTo);

      // A completed document: no DRAFT watermark, no _DRAFT suffix, and
      // everything typed above present in full.
      /* An unapproved document keeps _DRAFT in its filename -- that is the
         only mark it carries now that the watermark is gone. */
      check(/_DRAFT/.test(suggestedName), `Unapproved export is named _DRAFT (got "${suggestedName}")`);
      const contract = await checkPdfContract(pdf, {
        label: 'ui-workflow',
        pages: 2,
        draft: false,
        mustContain: [
          'Jordan Blake', 'Casey Renn', 'Laborer',
          'Employee failed to wear required fall protection while working at height on the scaffold.',
          'Employee must wear fall protection at all times above six feet, verified daily by the foreman.',
          'The company will retrain the employee on fall protection requirements.',
          'Further violations will result in suspension or termination.',
        ],
      });
      contract.forEach(r => check(r.ok, r.label));
      // The page carries the company logo plus both signatures the test drew.
      check(pdf.pages[0].images.length === 3, `Logo + both drawn signatures embedded in the PDF (found ${pdf.pages[0].images.length} images)`);

      // Reload and confirm the draft (now completed) persisted.
      await page.reload({ waitUntil: 'networkidle' });
      const raw = await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY);
      const persisted = JSON.parse(raw || 'null');
      check(Boolean(persisted) && persisted.employeeName === 'Jordan Blake', 'Draft persisted to localStorage under sdc.discipline.draft.v1 after reload');
      // Mark Complete stores 'ready' ('completed' is the accepted legacy
      // value) — and creating/downloading the PDF must NOT change status
      // (auto-locking on export was removed by the completion-toggle work).
      // Nobody can mark their own document complete any more, so a reload
      // must find it exactly as it was: a draft, waiting on an approver.
      check(persisted?.status === "draft", `Still a draft after reload (got "${persisted?.status}")`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

      // Clean up this draft so it doesn't leak into later sections.
      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    // ── 2. Employee refused/unavailable to sign — must not block the checklist ──
    // A real, common outcome: the employee isn't present, or won't sign. That
    // must not leave the notice permanently stuck as an unfinished DRAFT with
    // no way to mark it complete (see disciplinaryModel.js's
    // employeeRefusedToSign). Manager still has to sign — only the employee
    // half is excused.
    console.log('\n=== 2. Employee refused/unavailable to sign ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Wade Coker');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Ray Ferris');
      await page.getByRole('button', { name: 'Final Warning', exact: true }).click();
      await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Employee left the site without notice after a safety violation was raised; not present to sign or respond.');

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Corrective Action');
      await page.getByRole('textbox', { name: 'What must the employee do to correct this?', exact: true }).fill('Employee must report to HR before returning to any jobsite.');

      // Toggle refused BEFORE signing anything — this is the point of the
      // fix: the employee slot must never accept input while refused is set.
      // BooleanToggle renders <label class="field"><span>label text</span>
      // <div class="yesNoToggle"><button>Yes/No</button></div></label> — the
      // button's own accessible name is just "No"/"Yes", so scope by the
      // .field container's text instead of the button's own name.
      // The refused toggle lives on the signatures step alongside the pads.
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(400);
      /* Asked as a plain question now -- "Is the employee signing this?"
         with Yes / "No — refused or not available" -- rather than a
         negative toggle a foreman had to read twice. */
      await page.getByRole('button', { name: /No — refused or not available/ }).first().click();
      await page.waitForTimeout(300);
      const employeeAddSigCount = await page.locator('.signaturePad', { hasText: 'Employee Signature' }).getByRole('button', { name: 'Add signature' }).count();
      check(employeeAddSigCount === 0, 'Employee signature pad is not offered once refused/unavailable is toggled on');

      // Only the manager signs.
      await page.locator('.signaturePad', { hasText: 'Manager Signature' }).getByRole('button', { name: 'Add signature' }).click();
      const canvas = page.locator('canvas.signatureCanvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 8 });
      await page.mouse.up();
      await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();

      await page.getByRole('tab', { name: /Submit/i }).first().click();
      await page.waitForTimeout(400);
      await page.waitForSelector('text=Readiness');
      const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
      check(pendingItems === 0, `Checklist fully satisfied with only a manager signature, once refused is set (${pendingItems} pending item(s))`);

      /* The old bug here was that Mark Complete stayed permanently
         disabled when the employee refused to sign. That button is gone
         now, so what matters is that the CHECKLIST clears with only a
         manager signature -- otherwise the notice could never be sent for
         review at all. That is the check above. */
      const badge = await page.locator('.builderHeaderBadges .badge').first().innerText();
      check(badge.trim().toLowerCase() === 'draft', `Draft until approved (got "${badge.trim()}")`);

      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { pdf, suggestedName } = await downloadGeneratedPdf(page, path.join(outDir, 'employee-refused.pdf'));
      check(/_DRAFT/.test(suggestedName), `Unapproved export is named _DRAFT (got "${suggestedName}")`);
      const contract = await checkPdfContract(pdf, {
        label: 'employee-refused',
        pages: 1,
        draft: false,
        mustContain: ['Wade Coker', 'Refused / Unavailable to Sign'],
      });
      contract.forEach(r => check(r.ok, r.label));
      // Logo + manager's signature only — no employee signature image, and
      // no signing date printed next to the refusal note (see pdfDraw.js's
      // signatureRow: a note suppresses dateValue, matching multiSignatureRow).
      check(pdf.pages[0].images.length === 2, `Only logo + manager signature embedded, no employee signature (found ${pdf.pages[0].images.length} images)`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

      await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
      await context.close();
    }

    // ── 3. Draft collision isolation: Disciplinary draft must not touch JSA/Incident keys ──
    console.log('\n=== 3. Draft key isolation ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.discipline.draft.v1', json), loadFixture('disciplinary-normal.json'));
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      const keys = await page.evaluate(() => Object.keys(window.localStorage));
      check(keys.includes('sdc.discipline.draft.v1'), 'Disciplinary draft key present');
      const jsaDraftUntouched = await page.evaluate(() => window.localStorage.getItem('sdc.jsa.draft.v4'));
      check(jsaDraftUntouched === null, 'Seeding a Disciplinary draft does not create/touch sdc.jsa.draft.v4');
      const incidentDraftUntouched = await page.evaluate(() => window.localStorage.getItem('sdc.incident.draft.v1'));
      check(incidentDraftUntouched === null, 'Seeding a Disciplinary draft does not create/touch sdc.incident.draft.v1');
      await page.evaluate(() => window.localStorage.clear());
      await context.close();
    }

    // ── 3. PDF content fixtures, checked against the REAL generated PDF ──
    //
    // This document is drawn straight into the PDF by disciplinaryPdfDraw.js,
    // so the hidden .docPdfExportRoot DOM is no longer what gets printed and
    // measuring it proves nothing about the artifact. Every check below reads
    // the downloaded PDF itself.
    console.log('\n=== 4. PDF fixtures (real generated PDF) ===');
    const fixtures = [
      {
        name: 'disciplinary-normal.json',
        label: 'normal',
        expectMaxPages: 1,
        // Values the user typed, and the full section headings. A heading
        // that comes back short is truncation, which on a signed record is
        // data loss rather than a cosmetic defect.
        // Headings are the paper form's own wording (2026-08-12 fidelity
        // audit) — sections 2 and 5 had been shortened, and the source
        // sentence "This notice serves as:" had been replaced by a label.
        mustContain: [
          'Marcus Doyle', 'Ray Ferris', 'Equipment Operator',
          'This notice serves as:',
          'If behavior is not corrected/performance does not improve',
          'Corrective action that must be taken by the employee',
          'Earlier verbal or written warnings, discussions, etc. on this issue',
          'Employee operated the excavator without a spotter present',
        ],
      },
      { name: 'disciplinary-long-section1.json', label: 'long-section1', expectMaxPages: 2 },
      // All 7 numbered sections stuffed with long text simultaneously is a
      // deliberately pathological case (no real disciplinary notice would
      // ever have every section this long) — the important thing is safe,
      // uncapped pagination, not hitting a specific page count.
      { name: 'disciplinary-long-multisection.json', label: 'long-multisection', expectMaxPages: 10 },
    ];
    const summary = [];
    for (const fx of fixtures) {
      console.log(`\n--- Fixture: ${fx.label} ---`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.discipline.draft.v1', json), loadFixture(fx.name));
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      // Load the fixture via the real Drafts -> Open Draft path (the entry
      // point that actually populates the editable model — "Start" always
      // begins a blank document, see makeDraftEntryPoints in main.jsx).
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      const draftRow = page.locator('.listItem', { hasText: 'Warning level' });
      await draftRow.getByRole('button', { name: 'Open' }).click();
      await page.waitForSelector('text=Notice Details').catch(() => {});

      // Submit is a step of its own, reached from the step nav.
      await page.getByRole('tab', { name: /Submit/i }).first().click();
      await page.waitForTimeout(400);
      await page.locator('.reviewPrimaryAction button').first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const headline = (await page.locator('.pdfReadyHeadline').innerText()).trim();
      const pageCount = parseInt(headline, 10);
      console.log(`  PDF ready: ${headline}`);
      check(Number.isFinite(pageCount) && pageCount >= 1 && pageCount <= fx.expectMaxPages, `Page count within expected range (got ${pageCount}, expected 1-${fx.expectMaxPages})`);

      // Download the real artifact and check it, rather than the DOM that no
      // longer builds it.
      const { pdf, suggestedName } = await downloadGeneratedPdf(page, path.join(outDir, `${fx.label}.pdf`));
      check(pdf.pages.length === pageCount, `App's reported page count matches the real PDF (UI said ${pageCount}, PDF has ${pdf.pages.length})`);

      const contract = await checkPdfContract(pdf, {
        label: fx.label,
        pages: [1, fx.expectMaxPages],
        /* The DRAFT watermark was removed from these four documents
           entirely (Fonzo, 2026-09-09: "remove the draft stamp
           completely") -- a stamp saying DRAFT on a filed record is worse
           than no stamp. The _DRAFT filename is what marks an unapproved
           copy now. */
        draft: false,
        mustContain: fx.mustContain || [],
      });
      contract.forEach(r => check(r.ok, r.label));
      check(/_DRAFT\.pdf$/.test(suggestedName), `Draft export filename carries the _DRAFT suffix (got "${suggestedName}")`);

      check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)`);
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);

      summary.push({ fixture: fx.label, pageCount, pdfPages: pdf.pages.length, suggestedName, consoleErrors: consoleErrors.length, pageErrors: pageErrors.length });
      await context.close();
    }

    // ── 4. Mobile viewport (390px): no overflow, sidebar hidden, signature usable ──
    console.log('\n=== 5. Mobile viewport (390px) ===');
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      /* The mobile bar carries Home, My Work, Board, Records and Settings.
         Documents is not one of them -- you reach it from Home, the same
         way a superintendent does. */
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      const row = page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' });
      await row.getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `No horizontal overflow on phone (scrollWidth - clientWidth = ${overflow})`);
      const bottomNavHidden = await page.evaluate(() => {
        const el = document.querySelector('.mobileBottomNav');
        return !el || getComputedStyle(el).display === 'none';
      });
      check(bottomNavHidden, 'Bottom nav hidden while the Disciplinary Notice builder is open');

      // Smoke-test the shared SignaturePad's native touch listener path
      // (see src/incident/SignaturePad.jsx) with real CDP touch dispatch,
      // not synthetic JS calls into the component's internals.
      /* Signatures stay locked until the notice actually says something --
         you cannot sign a blank write-up -- so fill the content first,
         same as a foreman would. */
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Touch Smoke Test');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('button', { name: 'Written Warning', exact: true }).click();
      await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Smoke test of the signature pad on a phone-sized screen.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Corrective Action');
      await page.getByRole('textbox', { name: 'What must the employee do to correct this?', exact: true }).fill('Nothing — this is a test document.');
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(400);
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

    // ── 6. Stays a draft, stays editable, until an approver files it ──
    console.log('\n=== 6. Draft stays editable until approved ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Finish Lock Test');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Casey Renn');
      await page.getByRole('button', { name: 'Written Warning', exact: true }).click();
      await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Test occurrence.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Corrective Action');
      await page.getByRole('textbox', { name: 'What must the employee do to correct this?', exact: true }).fill('Test corrective action.');
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(400);
      for (let i = 0; i < 2; i += 1) {
        await page.locator('.signaturePad button', { hasText: 'Add signature' }).first().click();
        const canvas = page.locator('canvas.signatureCanvas').first();
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 20, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 6 });
        await page.mouse.up();
        await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
      }
      await page.getByRole('tab', { name: /Submit/i }).first().click();
      await page.waitForTimeout(400);

      /* This section used to prove that Mark Complete locked the form.
         That button is gone (2026-09-11): the man writing a write-up does
         not get to decide it is finished, because that took the DRAFT
         marking off a document nobody had approved. What has to be true
         now is the opposite -- it stays a draft, and stays editable, until
         an approver files it. The approver half is covered by
         verify-send-for-review.mjs and simulate-review-chain.mjs. */
      const badge = await page.locator('.builderHeaderBadges .badge').first().innerText();
      check(badge.toLowerCase() === 'draft', `Badge still reads Draft (got "${badge}")`);

      await page.getByRole('tab', { name: /Notice Details/ }).click();
      const nameField = page.getByRole('textbox', { name: 'Employee Name', exact: true });
      check(!(await nameField.isDisabled()), 'Still editable -- nothing is locked until it is approved');

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
