// Incident Photos regression script (Phase 1).
//
// Not part of the application build or bundle -- lives entirely under
// tools/testing/ and is invoked manually with
// `node tools/testing/verify-incident-photos.mjs`. Requires `npm run
// build` to have already produced dist/, and the `playwright` dev
// dependency (+ `npx playwright install chromium`) to be installed.
//
// Covers the Incident Photos feature end to end against the real UI and the
// real generated PDF (no mocking of IndexedDB, html2canvas, or pdf-lib):
//   1. Zero photos -> the existing six-page report is completely unchanged
//      (no appendix, no page-count change) -- the empty-state guarantee.
//   2. Adding photos (portrait + large source image, landscape + no
//      caption/category, long caption) -> real thumbnails render, and the
//      generated PDF appends a correctly-paginated Incident Photo Appendix
//      (2 photos/page) with correct total page numbering, no clipping, no
//      distortion.
//   3. Duplicate-upload protection (confirm-to-override, not a hard block).
//   4. Removing a photo -> both the UI and the next generated PDF reflect
//      it (page count drops).
//   5. Reload persistence -- IndexedDB blobs and metadata both survive a
//      real page reload (proves storage, not just in-memory React state).
//   6. Draft deletion cleanup -- starting a new incident report deletes the
//      discarded draft's photo blobs from IndexedDB (no orphaned storage).
// Throughout, zero console errors, zero page errors, and (per generated
// PDF page) no clipped content are asserted the same way
// verify-incident-pdf.mjs already does for the base six pages.
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
const outDir = path.join(__dirname, process.env.INCIDENT_PHOTOS_VERIFY_OUTDIR || 'output', 'incident-photos');
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

// Generic clipping guard, same as verify-incident-pdf.mjs -- .incidentPage
// has overflow:hidden, so a real overflow is silently clipped rather than
// erroring; scrollHeight > clientHeight is the reliable signal.
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

async function main() {
  console.log('[1/3] Generating synthetic test photos...');
  const fixturesDir = path.join(outDir, 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
  // Portrait, large (simulates an uncompressed modern-phone photo -- also
  // exercises the resize/compression path, not just the decode path).
  const portraitPath = path.join(fixturesDir, 'portrait-large.png');
  writeFileSync(portraitPath, makeTestPng(3024, 4032, [200, 60, 60]));
  // Landscape, normal size, deliberately no caption/category added later.
  const landscapePath = path.join(fixturesDir, 'landscape.png');
  writeFileSync(landscapePath, makeTestPng(1600, 1200, [60, 130, 200]));
  // Square-ish, paired with a long caption to test the caption-overflow
  // guard in the appendix layout.
  const thirdPath = path.join(fixturesDir, 'third-photo.png');
  writeFileSync(thirdPath, makeTestPng(1400, 1400, [60, 170, 90]));
  console.log('    Wrote', portraitPath, landscapePath, thirdPath);

  console.log('[2/3] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  const a = makeAssertions('Incident Photos');
  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[3/3] Preview server ready at', BASE_URL);

    // Patched to status: 'draft' before seeding -- this fixture is shared
    // with verify-incident-pdf.mjs (which needs the file's own status:
    // 'ready' for its final/un-watermarked rendering test), but this
    // script's own purpose is adding/removing photos, which now requires an
    // unlocked document (see the app-wide draft/finish/lock UX mission --
    // 'ready' is genuinely locked now, not just un-watermarked).
    const fixture = { ...JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8')), status: 'draft' };
    const fixtureJson = JSON.stringify(fixture);

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.addInitScript((json) => {
      window.localStorage.setItem('sdc.incident.draft.v1', json);
    }, fixtureJson);
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    console.log('\n=== 1. Empty state: no photos leaves the six-page report unchanged ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue Incident Report' }).click();
    await page.getByRole('tab').last().click();
    await generatePdf(page);
    let pageCount = await page.locator('.incidentPdfExportRoot .incidentPage').count();
    a.check(pageCount === 6, `expected 6 pages with zero photos, got ${pageCount}`);
    let appendixCount = await page.locator('.incPhotoAppendixPage').count();
    a.check(appendixCount === 0, `expected no photo appendix page with zero photos, found ${appendixCount}`);

    console.log('\n=== 2. Adding photos: portrait+large, landscape (no caption/category), long-caption ===');
    await page.getByRole('tab', { name: /^Photos/ }).click();
    await page.locator('h3:has-text("Incident Photos")').waitFor({ state: 'visible' });
    const addBtnBox = await page.locator('.incPhotoAddBtn').boundingBox();
    a.check(Boolean(addBtnBox && addBtnBox.height >= 44), `expected the Add photo button to be a real touch target (>=44px tall), got ${addBtnBox?.height}px`);

    const fileInput = page.locator('.incPhotoFileInput');
    await fileInput.setInputFiles([portraitPath, landscapePath, thirdPath]);
    await page.waitForFunction(() => document.querySelectorAll('.incPhotoCard').length === 3, { timeout: 20000 });
    await page.locator('.incPhotoCard .incPhotoCardThumb').first().waitFor({ state: 'visible', timeout: 20000 });

    const cards = page.locator('.incPhotoCard');
    a.check(await cards.count() === 3, `expected 3 photo cards after adding 3 photos, got ${await cards.count()}`);

    const longCaption = 'Close-up of the damaged coupling and surrounding graded fill area, taken immediately after the incident to document the exact condition of the site before any cleanup or repair work began. '.slice(0, 210);
    // Photo 1 (portrait/large): category + normal caption.
    await cards.nth(0).locator('select').selectOption('Incident Area');
    await cards.nth(0).locator('input[type="text"]').fill('Wide view of the incident area near the lime mixing station.');
    // Photo 2 (landscape): left blank on purpose (optional fields).
    // Photo 3: category + long caption.
    await cards.nth(2).locator('select').selectOption('Equipment Involved');
    await cards.nth(2).locator('input[type="text"]').fill(longCaption);

    const thumbSrcs = await page.locator('.incPhotoCard .incPhotoCardThumb').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));
    a.check(thumbSrcs.every((src) => src && src.startsWith('blob:')), `expected every thumbnail to render from a real blob: object URL, got ${JSON.stringify(thumbSrcs)}`);

    console.log('\n=== 3. Duplicate-upload protection ===');
    let dialogMessage = null;
    page.once('dialog', (dialog) => { dialogMessage = dialog.message(); dialog.dismiss(); });
    await fileInput.setInputFiles([portraitPath]);
    await page.waitForTimeout(500);
    a.check(dialogMessage != null && /already added/i.test(dialogMessage), `expected a duplicate-upload confirmation dialog, got "${dialogMessage}"`);
    a.check(await cards.count() === 3, `expected duplicate to be skipped on Dismiss (still 3 cards), got ${await cards.count()}`);

    console.log('\n=== 4. Generating PDF with 3 photos: appendix pagination (2/page) ===');
    await page.getByRole('tab').last().click();
    await generatePdf(page);
    pageCount = await page.locator('.incidentPdfExportRoot .incidentPage').count();
    a.check(pageCount === 8, `expected 6 base pages + 2 appendix pages (3 photos, 2/page) = 8, got ${pageCount}`);
    appendixCount = await page.locator('.incPhotoAppendixPage').count();
    a.check(appendixCount === 2, `expected 2 appendix pages for 3 photos, got ${appendixCount}`);
    const blocksPerAppendixPage = await page.locator('.incPhotoAppendixPage').evaluateAll((pages_) => pages_.map((p) => p.querySelectorAll('.incPhotoBlock').length));
    a.check(JSON.stringify(blocksPerAppendixPage) === JSON.stringify([2, 1]), `expected [2, 1] photo blocks across the 2 appendix pages, got ${JSON.stringify(blocksPerAppendixPage)}`);

    const lastPageLabel = await page.locator('.incidentPdfExportRoot .incidentPage').last().locator('.incidentHeaderPageNum').innerText();
    a.check(lastPageLabel === 'Page 8 of 8', `expected true final page numbering "Page 8 of 8", got "${lastPageLabel}"`);
    const firstAppendixHeader = await page.locator('.incPhotoAppendixPage').first().locator('xpath=../..').locator('h2').innerText();
    // Deliberately exact, not a substring match: the appendix is its own
    // labeled section, not a text-overflow continuation, so it must NOT
    // read "CONTINUATION — INCIDENT PHOTO APPENDIX" (see IncidentHeader in
    // IncidentPdf.jsx -- that prefix is only ever added by
    // ContinuationPage's own separate header, never by this one).
    a.check(firstAppendixHeader === 'INCIDENT PHOTO APPENDIX', `expected the appendix page header to read exactly "INCIDENT PHOTO APPENDIX" (no "CONTINUATION —" prefix), got "${firstAppendixHeader}"`);

    const appendixImages = await page.locator('.incPhotoAppendixPage .incPhotoImage').count();
    a.check(appendixImages === 3, `expected all 3 photos to render as real images in the appendix, got ${appendixImages}`);
    // .incPhotoCategoryTag is rendered with CSS text-transform: uppercase
    // (see incident.css), so innerText reflects the transformed case --
    // compare case-insensitively, same convention as the badge check in
    // verify-incident-workflow.mjs.
    const categoryTags = (await page.locator('.incPhotoCategoryTag').allInnerTexts()).map((s) => s.toLowerCase());
    a.check(categoryTags.includes('incident area') && categoryTags.includes('equipment involved'), `expected the two categorized photos' tags to render, got ${JSON.stringify(categoryTags)}`);
    const noCaptionBlockCount = await page.locator('.incPhotoBlock:not(:has(.incPhotoCaptionBar))').count();
    a.check(noCaptionBlockCount === 1, `expected exactly 1 photo block with no caption/category bar (the landscape photo), got ${noCaptionBlockCount}`);

    // Long-caption block: text must stay fully inside its block (no clipping/overlap into the next block).
    const longCaptionBlock = page.locator('.incPhotoBlock', { hasText: longCaption.slice(0, 40) });
    a.check(await longCaptionBlock.count() === 1, 'expected the long caption to render inside exactly one photo block');
    if (await longCaptionBlock.count() === 1) {
      const capMetrics = await longCaptionBlock.first().locator('.incPhotoCaptionText').evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      a.check(capMetrics.scrollHeight <= capMetrics.clientHeight + 2, `expected the long caption not to clip within its box (scrollHeight ${capMetrics.scrollHeight} <= clientHeight ${capMetrics.clientHeight})`);
    }
    // No two photo blocks on the same page overlap vertically.
    const blockBoxesByPage = [];
    const appendixPages = await page.locator('.incPhotoAppendixPage').all();
    for (const p of appendixPages) {
      const boxes = await p.locator('.incPhotoBlock').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      blockBoxesByPage.push(boxes);
    }
    blockBoxesByPage.forEach((boxes, pageIdx) => {
      for (let i = 1; i < boxes.length; i += 1) {
        a.check(boxes[i].top >= boxes[i - 1].bottom - 0.5, `appendix page ${pageIdx + 1}: photo block ${i + 1} should not overlap block ${i} (block ${i} bottom=${boxes[i - 1].bottom.toFixed(1)}, block ${i + 1} top=${boxes[i].top.toFixed(1)})`);
      }
    });

    await assertNoClipping(a, page);

    // Aspect-correctness sanity: the portrait photo's rendered image should
    // be taller-than-wide, the landscape one wider-than-tall -- proves
    // object-fit:contain preserved orientation instead of stretching both
    // to fill the same box shape.
    const imgBoxes = await page.locator('.incPhotoAppendixPage .incPhotoImage').evaluateAll((imgs) => imgs.map((img) => img.getBoundingClientRect().toJSON()));
    a.check(imgBoxes[0].height > imgBoxes[0].width, `expected the portrait photo's rendered image to be taller than wide, got ${imgBoxes[0].width.toFixed(0)}x${imgBoxes[0].height.toFixed(0)}`);
    a.check(imgBoxes[1].width > imgBoxes[1].height, `expected the landscape photo's rendered image to be wider than tall, got ${imgBoxes[1].width.toFixed(0)}x${imgBoxes[1].height.toFixed(0)}`);

    console.log('\n=== 5. Removing a photo updates both the UI and the next PDF ===');
    await page.getByRole('tab', { name: /^Photos/ }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.incPhotoCard').nth(1).locator('.incPhotoRemoveBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.incPhotoCard').length === 2, { timeout: 10000 });
    a.check(await page.locator('.incPhotoCard').count() === 2, 'expected 2 photo cards remaining after removing one');

    await page.getByRole('tab').last().click();
    await generatePdf(page);
    pageCount = await page.locator('.incidentPdfExportRoot .incidentPage').count();
    a.check(pageCount === 7, `expected 6 base pages + 1 appendix page (2 photos remaining) = 7, got ${pageCount}`);
    appendixCount = await page.locator('.incPhotoAppendixPage').count();
    a.check(appendixCount === 1, `expected exactly 1 appendix page for 2 remaining photos, got ${appendixCount}`);

    console.log('\n=== 6. Reload persistence (IndexedDB blobs + metadata survive a real reload) ===');
    // context.addInitScript scripts re-run on EVERY new document in the
    // context -- including page.reload(), not just the first goto(). The
    // original init script (registered at context creation, above) would
    // otherwise re-seed the STALE original fixture on reload, stomping the
    // real localStorage writes this test just made -- that's a test
    // artifact, not app behavior, so re-seed a second init script with the
    // CURRENT real draft content; Playwright runs registered init scripts
    // in registration order, so this one re-applies (harmlessly, since it's
    // now the same content the app already wrote) after the original.
    const currentDraftJson = await page.evaluate(() => localStorage.getItem('sdc.incident.draft.v1'));
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, currentDraftJson);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue Incident Report' }).click();
    await page.getByRole('tab', { name: /^Photos/ }).click();
    // waitForFunction's 2nd positional parameter is `arg` (passed into the
    // page function), NOT options -- options is the 3rd parameter.
    await page.waitForFunction(() => document.querySelectorAll('.incPhotoCard').length === 2, undefined, { timeout: 15000 }).catch(() => {});
    const reloadedCardCount = await page.locator('.incPhotoCard').count();
    a.check(reloadedCardCount === 2, `expected 2 photo cards to survive a page reload, got ${reloadedCardCount}`);
    if (reloadedCardCount > 0) {
      await page.locator('.incPhotoCard .incPhotoCardThumb').first().waitFor({ state: 'visible', timeout: 20000 });
      const reloadedThumbSrcs = await page.locator('.incPhotoCard .incPhotoCardThumb').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));
      a.check(reloadedThumbSrcs.every((src) => src && src.startsWith('blob:')), `expected thumbnails to reload from real IndexedDB blobs after reload, got ${JSON.stringify(reloadedThumbSrcs)}`);
    }

    console.log('\n=== 7. Draft deletion cleans up orphaned photo blobs ===');
    const discardedIncidentId = fixture.id;
    const beforeCount = await page.evaluate((incidentId) => new Promise((resolve, reject) => {
      const req = indexedDB.open('sdc-incident-photos-v1');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('blobs', 'readonly');
        const idx = tx.objectStore('blobs').index('incidentId');
        const countReq = idx.count(IDBKeyRange.only(incidentId));
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => reject(countReq.error);
      };
      req.onerror = () => reject(req.error);
    }), discardedIncidentId);
    a.check(beforeCount === 2, `expected 2 stored photo blobs for the current draft before discarding it, found ${beforeCount}`);

    await page.getByRole('tab').last().click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Start new Incident Report' }).click();
    await page.waitForTimeout(500);

    const afterCount = await page.evaluate((incidentId) => new Promise((resolve, reject) => {
      const req = indexedDB.open('sdc-incident-photos-v1');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('blobs', 'readonly');
        const idx = tx.objectStore('blobs').index('incidentId');
        const countReq = idx.count(IDBKeyRange.only(incidentId));
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => reject(countReq.error);
      };
      req.onerror = () => reject(req.error);
    }), discardedIncidentId);
    a.check(afterCount === 0, `expected 0 stored photo blobs for the discarded draft after starting a new report (no orphaned storage), found ${afterCount}`);

    console.log('\n=== 8. Application health ===');
    a.check(consoleErrors.length === 0, `expected zero console errors, found ${consoleErrors.length}: ${JSON.stringify(consoleErrors.slice(0, 5))}`);
    a.check(pageErrors.length === 0, `expected zero page errors, found ${pageErrors.length}: ${JSON.stringify(pageErrors.slice(0, 5))}`);

    await page.addStyleTag({ content: '.incidentPdfExportRoot { position: static !important; left: 0 !important; } .incidentPdfExportRoot .incidentPage { margin: 0 0 24px !important; box-shadow: 0 0 0 1px #ccc; } .toast { display: none !important; }' });
    const finalPages = await page.locator('.incidentPdfExportRoot .incidentPage').all();
    for (let i = 0; i < finalPages.length; i += 1) {
      await finalPages[i].screenshot({ path: path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`) });
    }
    console.log(`    Wrote ${finalPages.length} page screenshots to ${outDir}`);

    await context.close();
    await browser.close();

    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), assertionFailures: a.failures, consoleErrors, pageErrors,
    }, null, 2));

    console.log('\n=== OVERALL SUMMARY ===');
    if (a.failures.length) {
      console.error(`FAILED: ${a.failures.length} assertion(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('All Incident Photos regression checks passed.');
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
