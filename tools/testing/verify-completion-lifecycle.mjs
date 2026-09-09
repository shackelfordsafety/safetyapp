// Completion-state lifecycle regression across the five locking document
// types, driven through the REAL UI against a vite preview of the
// production build.
//
//   node tools/testing/verify-completion-lifecycle.mjs > out.log 2>&1
//
// For each document it walks the whole state machine and asserts at every
// hop, rather than trusting that the buttons exist:
//
//   Draft
//   -> Create Document        (filename carries _DRAFT)
//   -> STILL EDITABLE         (generating a PDF must not lock anything)
//   -> Mark Complete          (badge Completed, fields disabled)
//   -> prior document STALE   (the watermarked DRAFT must not stay downloadable)
//   -> Update Document        (filename has NO _DRAFT)
//   -> Mark Incomplete        (badge Draft, fields editable again)
//   -> prior FINAL STALE      (an un-watermarked file must not survive unlocking)
//
// The DRAFT and FINAL PDFs are saved for raster inspection, so this doubles
// as the fresh-PDF generator for the four Superintendent documents.
//
// Incident's page count is asserted to stay at its protected value.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'lifecycle');
mkdirSync(outDir, { recursive: true });

const PORT = 4343;
const BASE_URL = `http://localhost:${PORT}`;

const DOCS = [
  { id: 'disciplinary', key: 'sdc.discipline.draft.v1', fixture: 'disciplinary-normal.json' },
  { id: 'separation', key: 'sdc.separation.draft.v1', fixture: 'separation-new-involuntary.json' },
  { id: 'medicalEvent', key: 'sdc.medical.draft.v1', fixture: 'medical-work-event.json' },
  { id: 'uncontrolledEvent', key: 'sdc.uncontrolled.draft.v1', fixture: 'uncontrolled-spill.json' },
  { id: 'incident', key: 'sdc.incident.draft.v1', fixture: 'incident-full-fixture.json', expectPages: 6 },
];

let failures = 0;
const results = [];

function check(docId, label, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  results.push({ docId, label, ok, detail });
  return ok;
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error('server not ready'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

const badgeText = page => page.locator('.builderHeaderBadges .badge').first().innerText();

// "Editable" means a real form control on a real content step accepts input —
// not merely that the review panel offers a button.
async function firstStepFieldsDisabled(page) {
  await page.locator('.stepperSeg').first().click();
  await page.waitForTimeout(350);
  const field = page.locator('input:not([type=hidden]), textarea, select').first();
  await field.waitFor({ state: 'attached', timeout: 10000 });
  const disabled = await field.isDisabled();
  // back to the last step (Review)
  await page.locator('.stepperSeg').last().click();
  await page.waitForTimeout(350);
  return disabled;
}

async function gotoReview(page) {
  for (let i = 0; i < 14; i += 1) {
    if (await page.locator('.pdfReadyPanel, .pdfStaleWarning, .reviewPrimaryAction').count() > 0) return true;
    const review = page.getByRole('button', { name: 'Go to Review' });
    if (await review.count() > 0 && await review.first().isVisible().catch(() => false)) {
      await review.first().click(); await page.waitForTimeout(300); continue;
    }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (await next.count() > 0 && await next.first().isVisible().catch(() => false)) {
      await next.first().click(); await page.waitForTimeout(300); continue;
    }
    return false;
  }
  return false;
}

async function generate(page) {
  await page.locator('button', { hasText: /^(Create Document|Update Document)$/ }).first().click();
  await page.waitForSelector('.pdfReadyPanel', { timeout: 90000 });
  return {
    filename: (await page.locator('.pdfReadyFilename').innerText()).trim(),
    pageCount: (await page.locator('.pdfReadyHeadline').innerText()).trim(),
  };
}

async function saveDownload(page, label) {
  const p = page.waitForEvent('download');
  await page.locator('button', { hasText: 'Download Document' }).click();
  const d = await p;
  const file = path.join(outDir, `${label}.pdf`);
  await d.saveAs(file);
  return file;
}

async function runDoc(browser, doc) {
  console.log(`\n--- ${doc.id} (${doc.fixture})`);
  // Seed as a DRAFT regardless of what the shared fixture ships with —
  // incident-full-fixture.json is status:"ready" because other suites need a
  // completed report, and this walk has to start from the beginning of the
  // state machine. Normalizing here beats mutating a fixture those suites
  // (and the protected page counts) depend on.
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', doc.fixture), 'utf8'));
  const fixtureJson = JSON.stringify({ ...fixture, status: 'draft', completedAt: '' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(([k, j]) => window.localStorage.setItem(k, j), [doc.key, fixtureJson]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'Today' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.listItem button', { hasText: 'Open' }).first().click();
  await page.waitForTimeout(500);
  if (!await gotoReview(page)) { check(doc.id, 'reached Review step', false); await context.close(); return; }

  // Historically this walk also swept the four Superintendent documents'
  // off-screen `.docPdfExportRoot` DOM for a structural invariant (every
  // InfoTable row spans the same number of columns — a row spanning fewer
  // has no cells on its right, so `border-collapse` draws no border there
  // and the printed page shows one row whose right edge is simply missing;
  // this is exactly how Medical Event's Evaluation block shipped a broken
  // row). That DOM stopped being what produces the PDF once those four
  // documents were converted to drawn PDFs, and the export root components
  // (DisciplinaryPdf.jsx etc.) were deleted once nothing depended on them —
  // see 2026-08-13. The equivalent guarantee against the REAL printed
  // artifact is `checkPdfContract`'s "every row fills its column" check
  // (pdfContract.mjs), which runs in each of verify-disciplinary.mjs /
  // verify-separation.mjs / verify-medical-event.mjs /
  // verify-uncontrolled-event.mjs on every generated PDF. It is a stronger
  // check than this one ever was: pdfDraw.js's `infoTable` stencil can only
  // ever draw a full-width row in the first place, so the class of bug this
  // caught is now structurally prevented rather than merely detected.
  // Incident never used `.docPdfExportRoot` (it has its own PDF pipeline),
  // so removing this cost it nothing.

  // 1. starts as an editable draft
  check(doc.id, 'starts with Draft badge', (await badgeText(page)).trim().toLowerCase() === 'draft');
  check(doc.id, 'starts editable', (await firstStepFieldsDisabled(page)) === false);

  // 2. Create Document -> watermarked DRAFT filename
  const first = await generate(page);
  check(doc.id, 'DRAFT filename carries _DRAFT suffix', /_DRAFT\.pdf$/.test(first.filename), first.filename);
  if (doc.expectPages) {
    check(doc.id, `page count is the protected ${doc.expectPages}`,
      first.pageCount === `${doc.expectPages} pages`, first.pageCount);
  }
  await saveDownload(page, `${doc.id}-DRAFT`);

  // 3. creating a document must NOT lock the form
  check(doc.id, 'still Draft after Create Document', (await badgeText(page)).trim().toLowerCase() === 'draft');
  check(doc.id, 'still editable after Create Document', (await firstStepFieldsDisabled(page)) === false);

  // 4. Mark Complete -> locked
  await page.locator('.reviewInlineAction button', { hasText: 'Mark Complete' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.dialogActions button.primary').click();
  await page.waitForTimeout(600);
  check(doc.id, 'badge reads Completed', (await badgeText(page)).trim().toLowerCase() === 'completed');
  check(doc.id, 'fields locked once complete', (await firstStepFieldsDisabled(page)) === true);
  check(doc.id, 'Mark Incomplete offered', await page.locator('.reviewInlineAction button', { hasText: 'Mark Incomplete' }).count() > 0);

  // 5. the watermarked DRAFT must now be stale
  check(doc.id, 'prior DRAFT document goes stale on completion',
    await page.locator('.pdfStaleWarning').count() > 0);

  // 6. Update Document -> FINAL, no _DRAFT suffix
  const final = await generate(page);
  check(doc.id, 'FINAL filename drops the _DRAFT suffix', !/_DRAFT\.pdf$/.test(final.filename), final.filename);
  if (doc.expectPages) {
    check(doc.id, `FINAL page count still ${doc.expectPages}`,
      final.pageCount === `${doc.expectPages} pages`, final.pageCount);
  }
  await saveDownload(page, `${doc.id}-FINAL`);

  // 7. Mark Incomplete -> unlocked again
  await page.locator('.reviewInlineAction button', { hasText: 'Mark Incomplete' }).first().click();
  await page.waitForTimeout(600);
  check(doc.id, 'badge back to Draft', (await badgeText(page)).trim().toLowerCase() === 'draft');
  check(doc.id, 'editable again after Mark Incomplete', (await firstStepFieldsDisabled(page)) === false);

  // 8. and the un-watermarked FINAL must not survive unlocking
  check(doc.id, 'prior FINAL document goes stale on unlock',
    await page.locator('.pdfStaleWarning').count() > 0);

  check(doc.id, 'zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    for (const doc of DOCS) await runDoc(browser, doc);
    await browser.close();
  } finally {
    killTree(server);
  }
  const total = results.length;
  console.log(`\n=== ${total - failures}/${total} assertions passed across ${DOCS.length} document types ===`);
  if (failures) {
    console.log('FAILED:');
    results.filter(r => !r.ok).forEach(r => console.log(`  ${r.docId}: ${r.label}${r.detail ? ` — ${r.detail}` : ''}`));
    console.log('\nCOMPLETION LIFECYCLE: FAILURES PRESENT');
  } else {
    console.log('COMPLETION LIFECYCLE: ALL CHECKS PASSED');
  }
  console.log(`PDFs written to ${outDir}`);
}

main().then(() => {
  // The spawned vite grandchild keeps Node's event loop alive on Windows
  // even after killTree(server); without this a passing run hangs. Same guard
  // as every other verify-*.mjs.
  process.exit(failures ? 1 : 0);
}).catch(err => { console.error('completion-lifecycle crashed:', err); process.exit(1); });
