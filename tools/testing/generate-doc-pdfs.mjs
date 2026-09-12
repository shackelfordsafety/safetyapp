// Batch-generate real PDFs for the four Superintendent documents
// (Disciplinary, Separation, Medical Event, Uncontrolled Event) from
// fixtures, via the REAL UI path (Drafts -> Open Draft -> Review -> Create
// Document -> Download Document) against a vite preview of the production
// build. Output PDFs are the actual artifacts a field user would get.
//
//   node tools/testing/generate-doc-pdfs.mjs [fixtureOverride.json docId]
//
// Then run tools/testing/analyze-pdf-centering.mjs on each output.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'doc-pdfs');
mkdirSync(outDir, { recursive: true });

const PORT = 4329;
const BASE_URL = `http://localhost:${PORT}`;

const DOCS = [
  { id: 'disciplinary', key: 'sdc.discipline.draft.v1', fixture: 'disciplinary-normal.json' },
  { id: 'separation', key: 'sdc.separation.draft.v1', fixture: 'separation-new-involuntary.json' },
  { id: 'medicalEvent', key: 'sdc.medical.draft.v1', fixture: 'medical-work-event.json' },
  { id: 'uncontrolledEvent', key: 'sdc.uncontrolled.draft.v1', fixture: 'uncontrolled-spill.json' },
];

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

async function generateOne(browser, { id, key, fixture, label, touch }) {
  const fixtureJson = readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8');
  // touch: emulate a coarse-pointer device — capturePagesToPdf drops the
  // html2canvas scale from 2.5 to 2 on touch devices (the real iPad path).
  const context = await browser.newContext(touch
    ? { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 } });
  await context.addInitScript(([k, json]) => window.localStorage.setItem(k, json), [key, fixtureJson]);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
  await page.locator('.listItem button', { hasText: 'Open' }).first().click();
  await page.waitForTimeout(400);

  // Generic step navigation: walk forward until Create Document is reachable.
  for (let step = 0; step < 12; step += 1) {
    const create = page.getByRole('button', { name: /Create Document|Update the printout/ });
    if (await create.count() > 0 && await create.first().isVisible().catch(() => false)) {
      await create.first().click();
      break;
    }
    const review = page.getByRole('button', { name: 'Go to Review' });
    if (await review.count() > 0 && await review.first().isVisible().catch(() => false)) {
      await review.first().click();
      continue;
    }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (await next.count() > 0 && await next.first().isVisible().catch(() => false)) {
      await next.first().click();
      continue;
    }
    throw new Error(`${id}: no forward navigation button found at step ${step}`);
  }

  await page.waitForSelector('.pdfReadyPanel', { timeout: 45000 });
  const headline = (await page.locator('.pdfReadyHeadline').innerText()).trim();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('button', { hasText: 'Download' }).click();
  const download = await downloadPromise;
  const pdfPath = path.join(outDir, `${label || id}.pdf`);
  await download.saveAs(pdfPath);
  const suggested = download.suggestedFilename();
  console.log(`  ${id}: ${headline} -> ${pdfPath} (suggested name: ${suggested})${errors.length ? ` [${errors.length} console/page error(s)!]` : ''}`);
  if (errors.length) errors.forEach(e => console.log(`    ERROR: ${e}`));
  await context.close();
  return pdfPath;
}

async function main() {
  console.log('Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const touch = process.argv.includes('--touch');
    const override = (process.argv[2] && process.argv[3] && !process.argv[2].startsWith('--')
      ? [{ ...DOCS.find(d => d.id === process.argv[3]), fixture: process.argv[2], label: path.basename(process.argv[2], '.json') }]
      : DOCS).map(d => (touch ? { ...d, touch: true, label: `${d.label || d.id}-touch` } : d));
    for (const doc of override) {
      console.log(`Generating: ${doc.id} (${doc.fixture})`);
      await generateOne(browser, doc);
    }
    await browser.close();
  } finally {
    killTree(server);
  }
  console.log('Done.');
}

main().catch(err => { console.error('generate-doc-pdfs crashed:', err); process.exit(1); });
