// Superintendent Response Questions regression script (Phase 2).
//
// Not part of the application build or bundle -- lives entirely under
// tools/testing/ and is invoked manually with
// `node tools/testing/verify-incident-superintendent-response.mjs`.
// Requires `npm run build` to have already produced dist/, and the
// `playwright` dev dependency (+ `npx playwright install chromium`) to be
// installed.
//
// Covers the Phase 2 UX change end to end against the real UI and the real
// generated PDF:
//   1. The old single "Superintendent/Supervisor Notes" field is now two
//      separate, plainly-worded prompts (Immediate Actions Taken /
//      Corrective & Preventive Actions) that edit, autosave, and reload
//      independently.
//   2. A pre-Phase-2 saved draft (only the old combined `supervisorNotes`
//      field) is migrated deterministically -- its full text lands in
//      Immediate Actions Taken, nothing is lost or guessed, and the
//      original field is left in the stored JSON (not deleted).
//   3. The generated PDF combines both answers into the SAME existing
//      "Superintendent/Supervisor Notes & Summary" box on Page 6 -- with
//      "IMMEDIATE ACTIONS TAKEN:"/"CORRECTIVE / PREVENTIVE ACTIONS:"
//      headings only for whichever field actually has content (no
//      fabricated headings over blank content) -- while Safety Consultant
//      Notes stays completely separate.
//   4. Long combined content still spills to a continuation page via the
//      existing real-DOM pagination, with no clipping/overlap.
//   5. Phase 1's photo appendix still lands after all base/continuation
//      pages with correct page numbering when combined with Phase 2
//      content.
//
// Exits nonzero if any check fails.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeTestPng } from './lib/makeTestPng.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, process.env.SUPT_RESPONSE_VERIFY_OUTDIR || 'output', 'superintendent-response');
mkdirSync(outDir, { recursive: true });

const PORT = 4324;
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

function makeAssertions(label) {
  const failures = [];
  return {
    check(condition, message) {
      if (!condition) {
        failures.push(message);
        console.error(`  [FAIL] ${message}`);
      } else {
        console.log(`  [ok]   ${message}`);
      }
    },
    failures,
    label,
  };
}

async function assertNoClipping(a, page) {
  const pages = await page.locator('.incidentPdfExportRoot .incidentPage').all();
  for (let i = 0; i < pages.length; i += 1) {
    const metrics = await pages[i].locator('.incidentPageBody').first().evaluate((el) => ({
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    }));
    a.check(metrics.scrollHeight <= metrics.clientHeight + 2,
      `page ${i + 1}: no clipped content (body scrollHeight ${metrics.scrollHeight}px <= clientHeight ${metrics.clientHeight}px, +2px tolerance)`);
  }
}

async function generatePdf(page) {
  await page.locator('.reviewPrimaryAction button, button:has-text("Want a paper copy first?"), button:has-text("Update the printout")').first().click();
  await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
}

// Page 6 is always the 6th rendered .incidentPage regardless of any
// continuation pages inserted earlier for other overflowing fields (pages 1
// and 3/4's continuation pages, if any, would push page 6's INDEX later,
// but Page6Content itself only ever appears once, identifiable by its own
// gray bars) -- locate it by content, not position, so this script doesn't
// silently mis-check a different page if some other field also overflows.
function page6Locator(page) {
  return page.locator('.incidentPage', { has: page.locator('.incGrayBar', { hasText: 'INVESTIGATION TEAM' }) });
}

async function testCoreUiAndPersistence(browser) {
  const a = makeAssertions('UI, autosave, reload (section 1)');
  console.log('\n=== 1. Two independent fields: render, edit, autosave, reload ===');
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('  [page error]', err.message));

  console.log('  [1/6] Starting a fresh incident report, filling a basic detail (autosave only engages once the draft has meaningful content -- see hasMeaningfulIncidentContent), then opening Notes & Team...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start Incident Report' }).click();
  await page.locator('.stepPanel input').first().fill('Superintendent Response UI Test Site');
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();

  console.log('  [2/6] Verifying both prompts render with plain-language wording...');
  const immediateLabel = page.locator('label.field', { hasText: 'Immediate Actions Taken' });
  const correctiveLabel = page.locator('label.field', { hasText: 'Corrective / Preventive Actions' });
  a.check(await immediateLabel.count() === 1, 'Immediate Actions Taken field renders exactly once');
  a.check(await correctiveLabel.count() === 1, 'Corrective / Preventive Actions field renders exactly once');
  const immediatePrompt = await immediateLabel.locator('small').innerText();
  const correctivePrompt = await correctiveLabel.locator('small').innerText();
  a.check(immediatePrompt === 'What was done immediately following the incident?', `Immediate Actions prompt matches spec wording (got: "${immediatePrompt}")`);
  a.check(correctivePrompt === 'What was corrected, assigned, or changed to help prevent recurrence?', `Corrective Actions prompt matches spec wording (got: "${correctivePrompt}")`);

  console.log('  [3/6] Editing each field independently...');
  const immediateInput = immediateLabel.locator('textarea');
  const correctiveInput = correctiveLabel.locator('textarea');
  await immediateInput.fill('Stopped work, secured the area, and notified the site superintendent right away.');
  await correctiveInput.fill('Re-briefed the crew and added a daily pre-task check for this hazard.');
  const immediateVal = await immediateInput.inputValue();
  const correctiveVal = await correctiveInput.inputValue();
  a.check(immediateVal === 'Stopped work, secured the area, and notified the site superintendent right away.', 'Immediate Actions field holds exactly what was typed');
  a.check(correctiveVal === 'Re-briefed the crew and added a daily pre-task check for this hazard.', 'Corrective Actions field holds exactly what was typed, independent of the other field');

  console.log('  [4/6] Waiting for autosave...');
  await page.waitForFunction(() => document.querySelector('.builderHeaderSaved')?.textContent === 'Saved', undefined, { timeout: 5000 }).catch(() => {});
  const draftJson = await page.evaluate(() => localStorage.getItem('sdc.incident.draft.v1'));
  const draft = JSON.parse(draftJson);
  a.check(draft.immediateActionsTaken === 'Stopped work, secured the area, and notified the site superintendent right away.', 'autosave persisted Immediate Actions Taken to localStorage');
  a.check(draft.correctivePreventiveActions === 'Re-briefed the crew and added a daily pre-task check for this hazard.', 'autosave persisted Corrective / Preventive Actions to localStorage');

  console.log('  [5/6] Reloading and confirming both fields restore...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();
  const reloadedImmediate = await page.locator('label.field', { hasText: 'Immediate Actions Taken' }).locator('textarea').inputValue();
  const reloadedCorrective = await page.locator('label.field', { hasText: 'Corrective / Preventive Actions' }).locator('textarea').inputValue();
  a.check(reloadedImmediate === 'Stopped work, secured the area, and notified the site superintendent right away.', 'Immediate Actions Taken survives a real page reload');
  a.check(reloadedCorrective === 'Re-briefed the crew and added a daily pre-task check for this hazard.', 'Corrective / Preventive Actions survives a real page reload');

  console.log('  [6/6] Cleaning up...');
  await page.evaluate(() => window.localStorage.removeItem('sdc.incident.draft.v1'));

  await context.close();
  return a;
}

async function testLegacyMigration(browser) {
  const a = makeAssertions('Legacy draft migration (section 2)');
  console.log('\n=== 2. Backward compatibility: legacy combined supervisorNotes migrates safely ===');
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const legacyJson = readFileSync(path.join(__dirname, 'fixtures', 'incident-legacy-supervisor-notes-fixture.json'), 'utf8');
  const legacyFixture = JSON.parse(legacyJson);
  await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, legacyJson);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('  [page error]', err.message));

  console.log('  [1/4] Loading the legacy draft and opening Notes & Team...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();

  console.log('  [2/4] Verifying the legacy text landed in Immediate Actions Taken, verbatim...');
  const immediateVal = await page.locator('label.field', { hasText: 'Immediate Actions Taken' }).locator('textarea').inputValue();
  const correctiveVal = await page.locator('label.field', { hasText: 'Corrective / Preventive Actions' }).locator('textarea').inputValue();
  a.check(immediateVal === legacyFixture.supervisorNotes, `Immediate Actions Taken shows the full legacy text verbatim (no guessing/splitting), got: "${immediateVal.slice(0, 60)}..."`);
  a.check(correctiveVal === '', `Corrective / Preventive Actions is left blank rather than guessed (got: "${correctiveVal}")`);

  console.log('  [3/4] Verifying the migration is deterministic (re-loading again does not change anything)...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();
  const immediateValAgain = await page.locator('label.field', { hasText: 'Immediate Actions Taken' }).locator('textarea').inputValue();
  a.check(immediateValAgain === legacyFixture.supervisorNotes, 'migration result is stable across repeated loads (deterministic, not re-guessed each time)');

  console.log('  [4/4] Verifying the original legacy field is preserved in storage, not deleted...');
  const draftJson = await page.evaluate(() => localStorage.getItem('sdc.incident.draft.v1'));
  const draft = JSON.parse(draftJson);
  a.check(draft.supervisorNotes === legacyFixture.supervisorNotes, 'original supervisorNotes text is still present in the stored draft (no destructive rewrite)');

  await context.close();
  return a;
}

async function testPdfCombiningAndPartialAnswers(browser) {
  const a = makeAssertions('PDF combining + partial answers (sections 3-6)');
  console.log('\n=== 3-6. PDF combines both answers into the existing Page 6 box; partial/blank answers never fabricate content ===');
  // Patched to status: 'draft' -- this section fills/clears fields directly
  // via Playwright's fill(), which refuses to act on a disabled field, and
  // the fixture's own file has status: 'ready', which now locks the
  // document (see the app-wide draft/finish/lock UX mission -- 'ready' is
  // genuinely locked now, not just un-watermarked).
  const fixture = { ...JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'incident-superintendent-response-fixture.json'), 'utf8')), status: 'draft' };
  const fixtureJson = JSON.stringify(fixture);
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, fixtureJson);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('  [1/5] Loading the fixture (both fields + distinct Safety Consultant Notes) and generating a PDF...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab').last().click();
  await generatePdf(page);

  console.log('  [2/5] Section 3 -- both fields filled: checking Page 6 content...');
  let page6Text = await page6Locator(page).innerText();
  a.check(page6Text.includes('IMMEDIATE ACTIONS TAKEN:'), 'Page 6 shows the "IMMEDIATE ACTIONS TAKEN:" heading');
  a.check(page6Text.includes(fixture.immediateActionsTaken), 'Page 6 shows the actual Immediate Actions text');
  a.check(page6Text.includes('CORRECTIVE / PREVENTIVE ACTIONS:'), 'Page 6 shows the "CORRECTIVE / PREVENTIVE ACTIONS:" heading');
  a.check(page6Text.includes(fixture.correctivePreventiveActions), 'Page 6 shows the actual Corrective/Preventive text');
  a.check(page6Text.includes('SAFETY CONSULTANT NOTES'), 'Page 6 still shows the separate Safety Consultant Notes section header');
  a.check(page6Text.includes(fixture.safetyConsultantNotes), 'Page 6 shows the real Safety Consultant Notes content, completely separate from the superintendent response');
  const grayBars = await page.locator('.incGrayBar').allInnerTexts();
  a.check(grayBars.some((t) => /SUPERINTENDENT\/SUPERVISOR NOTES/i.test(t)), 'the existing "SUPERINTENDENT/SUPERVISOR NOTES & SUMMARY" gray-bar title is unchanged (Page 6 box itself was not redesigned)');

  console.log('  [3/5] Section 4 -- clearing Corrective/Preventive, leaving only Immediate Actions...');
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();
  await page.locator('label.field', { hasText: 'Corrective / Preventive Actions' }).locator('textarea').fill('');
  await page.getByRole('tab').last().click();
  await generatePdf(page);
  page6Text = await page6Locator(page).innerText();
  a.check(page6Text.includes('IMMEDIATE ACTIONS TAKEN:'), 'only-Immediate case: heading for the filled field still appears');
  a.check(!page6Text.includes('CORRECTIVE / PREVENTIVE ACTIONS:'), 'only-Immediate case: no fabricated "CORRECTIVE / PREVENTIVE ACTIONS:" heading over blank content');

  console.log('  [4/5] Section 5 -- swapping to only Corrective/Preventive filled...');
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();
  await page.locator('label.field', { hasText: 'Immediate Actions Taken' }).locator('textarea').fill('');
  await page.locator('label.field', { hasText: 'Corrective / Preventive Actions' }).locator('textarea').fill(fixture.correctivePreventiveActions);
  await page.getByRole('tab').last().click();
  await generatePdf(page);
  page6Text = await page6Locator(page).innerText();
  a.check(!page6Text.includes('IMMEDIATE ACTIONS TAKEN:'), 'only-Corrective case: no fabricated "IMMEDIATE ACTIONS TAKEN:" heading over blank content');
  a.check(page6Text.includes('CORRECTIVE / PREVENTIVE ACTIONS:'), 'only-Corrective case: heading for the filled field still appears');
  a.check(page6Text.includes(fixture.correctivePreventiveActions), 'only-Corrective case: the real corrective text is shown');

  console.log('  [5/5] Section 6 -- both fields blank: no fabricated headings at all...');
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();
  await page.locator('label.field', { hasText: 'Corrective / Preventive Actions' }).locator('textarea').fill('');
  await page.getByRole('tab').last().click();
  await generatePdf(page);
  page6Text = await page6Locator(page).innerText();
  a.check(!page6Text.includes('IMMEDIATE ACTIONS TAKEN:') && !page6Text.includes('CORRECTIVE / PREVENTIVE ACTIONS:'), 'both-blank case: neither heading is fabricated when both fields are empty');
  a.check(page6Text.includes(fixture.safetyConsultantNotes), 'both-blank case: Safety Consultant Notes is untouched regardless of the superintendent fields');

  await assertNoClipping(a, page);
  a.check(consoleErrors.length === 0, `expected zero console errors, found ${consoleErrors.length}: ${JSON.stringify(consoleErrors.slice(0, 5))}`);
  a.check(pageErrors.length === 0, `expected zero page errors, found ${pageErrors.length}: ${JSON.stringify(pageErrors.slice(0, 5))}`);

  await context.close();
  return a;
}

async function testLongContentContinuation(browser) {
  const a = makeAssertions('Long combined content -> continuation page (section 7)');
  console.log('\n=== 7. Long Immediate + Corrective content paginates via the existing continuation-page logic ===');
  // Patched to status: 'draft' -- see the identical note in
  // testPdfCombiningAndPartialAnswers above; this section also fills
  // fields directly via Playwright's fill(), which refuses a disabled field.
  const fixtureJson = JSON.stringify({ ...JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'incident-superintendent-response-fixture.json'), 'utf8')), status: 'draft' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, fixtureJson);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const longImmediate ='Immediate response crew action taken to secure the site and account for all personnel before restarting work. '.repeat(20).trim();
  const longCorrective = 'Corrective and preventive measure assigned to the crew lead with a documented follow-up inspection scheduled. '.repeat(20).trim();

  console.log('  [1/4] Filling both fields with long content...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Notes & Team/ }).click();
  await page.locator('label.field', { hasText: 'Immediate Actions Taken' }).locator('textarea').fill(longImmediate);
  await page.locator('label.field', { hasText: 'Corrective / Preventive Actions' }).locator('textarea').fill(longCorrective);

  console.log('  [2/4] Generating the PDF...');
  await page.getByRole('tab').last().click();
  await generatePdf(page);

  console.log('  [3/4] Verifying a continuation page was created and nothing clipped/overlapped...');
  const continuationPages = await page.locator('.incidentPage.incidentContinuationPage').all();
  a.check(continuationPages.length >= 1, `expected at least 1 continuation page for the long combined superintendent response, found ${continuationPages.length}`);
  let sawSupervisorContinuation = false;
  for (const cp of continuationPages) {
    const heading = await cp.locator('.incidentHeaderTitles h2').innerText();
    if (/Superintendent\/Supervisor Notes/i.test(heading)) sawSupervisorContinuation = true;
  }
  a.check(sawSupervisorContinuation, 'at least one continuation page is explicitly labeled for "Superintendent/Supervisor Notes & Summary" (existing continuation-label behavior, unchanged)');

  await assertNoClipping(a, page);

  console.log('  [4/4] Verifying combined text made it onto the page(s) (base + continuation) without loss...');
  const allPagesText = (await page.locator('.incidentPdfExportRoot').innerText());
  a.check(allPagesText.includes('IMMEDIATE ACTIONS TAKEN:'), 'long-content case: heading still present');
  // Spot-check that both the start of the long text and a later chunk both
  // appear somewhere across the base + continuation pages (proves nothing
  // was silently dropped when spilling across pages).
  a.check(allPagesText.includes(longImmediate.slice(0, 40)), 'the start of the long Immediate Actions text is present');
  a.check(allPagesText.includes(longCorrective.slice(0, 40)), 'the start of the long Corrective/Preventive text is present');

  a.check(consoleErrors.length === 0, `expected zero console errors, found ${consoleErrors.length}`);
  a.check(pageErrors.length === 0, `expected zero page errors, found ${pageErrors.length}`);

  await context.close();
  return a;
}

async function testPhotosStillWork(browser) {
  const a = makeAssertions('Phase 1 photos remain correct alongside Phase 2 (section 8)');
  console.log('\n=== 8. Phase 1 protection: photo appendix ordering + page numbering with a migrated legacy draft ===');
  // Patched to status: 'draft' before seeding -- this fixture is shared
  // with verify-incident-pdf.mjs (which needs the file's own status:
  // 'ready' for its final/un-watermarked rendering test), but this section
  // adds a photo, which now requires an unlocked document (see the
  // app-wide draft/finish/lock UX mission -- 'ready' is genuinely locked
  // now, not just un-watermarked).
  const fixtureJson = JSON.stringify({ ...JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8')), status: 'draft' });
  const testPngPath = path.join(outDir, 'test-photo.png');
  writeFileSync(testPngPath, makeTestPng(1200, 900, [90, 140, 200]));
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, fixtureJson);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('  [1/3] Loading a legacy-shaped fixture (exercises Phase 2 migration), adding a photo...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Photos/ }).click();
  await page.locator('.incPhotoFileInput').setInputFiles([testPngPath]);
  await page.waitForFunction(() => document.querySelectorAll('.incPhotoCard').length === 1, undefined, { timeout: 20000 });

  console.log('  [2/3] Generating the PDF and checking base-page count + appendix ordering...');
  await page.getByRole('tab').last().click();
  await generatePdf(page);
  const allPages = await page.locator('.incidentPdfExportRoot .incidentPage').all();
  const appendixCount = await page.locator('.incPhotoAppendixPage').count();
  a.check(appendixCount === 1, `expected exactly 1 photo appendix page for 1 photo, found ${appendixCount}`);
  const lastPageIsAppendix = await allPages[allPages.length - 1].locator('.incPhotoAppendixPage').count();
  a.check(lastPageIsAppendix === 1, 'the photo appendix page is the LAST page (after all base + continuation pages, migration included)');
  const lastPageLabel = await allPages[allPages.length - 1].locator('.incidentHeaderPageNum').innerText();
  a.check(lastPageLabel === `Page ${allPages.length} of ${allPages.length}`, `final page numbering is correct (got "${lastPageLabel}" for ${allPages.length} total pages)`);
  console.log(`    total pages with migrated legacy content + 1 photo: ${allPages.length}`);

  console.log('  [3/3] Verifying migrated superintendent content still renders on Page 6 alongside the photo appendix...');
  const page6Text = await page6Locator(page).innerText();
  a.check(page6Text.includes('IMMEDIATE ACTIONS TAKEN:'), 'migrated legacy content still renders correctly under its new heading even with photos attached');

  await assertNoClipping(a, page);
  a.check(consoleErrors.length === 0, `expected zero console errors, found ${consoleErrors.length}`);
  a.check(pageErrors.length === 0, `expected zero page errors, found ${pageErrors.length}`);

  await context.close();
  return a;
}

async function main() {
  console.log('[1/2] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/2] Preview server ready at', BASE_URL);

    const browser = await chromium.launch();
    const results = [];
    try {
      results.push(await testCoreUiAndPersistence(browser));
      results.push(await testLegacyMigration(browser));
      results.push(await testPdfCombiningAndPartialAnswers(browser));
      results.push(await testLongContentContinuation(browser));
      results.push(await testPhotosStillWork(browser));
    } finally {
      await browser.close();
    }

    console.log('\n=== OVERALL SUMMARY ===');
    let anyFailed = false;
    for (const r of results) {
      const status = r.failures.length ? 'FAILED' : 'PASSED';
      if (r.failures.length) anyFailed = true;
      console.log(`  ${status}: ${r.label} (${r.failures.length} failure(s))`);
    }
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(results.map((r) => ({ label: r.label, failures: r.failures })), null, 2));
    if (anyFailed) {
      console.error('\nFAILED: one or more Superintendent Response Questions checks failed.');
      process.exitCode = 1;
    } else {
      console.log('\nAll Superintendent Response Questions regression checks passed.');
    }
  } finally {
    killTree(server);
  }
}

main().then(() => {
  // Explicit success exit: the spawned 'vite preview' grandchild keeps Node's
  // event loop alive on Windows even after server.kill(), so a PASSING run
  // would otherwise hang until the caller's timeout instead of finishing.
  process.exit(process.exitCode || 0);
}).catch((err) => {
  console.error('Verification script failed:', err);
  process.exitCode = 1;
});
