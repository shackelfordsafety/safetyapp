// Review-evidence capture for the changes on the `testing` branch.
//
//   node tools/testing/review-package.mjs > out.log 2>&1
//
// Drives the REAL UI against a vite preview of the production build and
// captures, per CLAUDE.md's review-workflow step:
//   * the Review & Export panel in its outstanding-items state (the readiness
//     checklist inversion) and its ready state (the button-weight fix),
//   * the Mark Complete confirm dialog and the resulting locked/Completed
//     state (the terminology unification),
//   * a real generated DRAFT pdf (watermarked) and FINAL pdf (not), which is
//     also the artifact the PDF-baseline fix has to be judged on.
//
// Captured at tablet portrait (device priority 1) and desktop.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'review-package');
mkdirSync(outDir, { recursive: true });

const PORT = 4341;
const BASE_URL = `http://localhost:${PORT}`;

const VIEWPORTS = [
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
];

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

async function newPage(browser, vp, seed) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...(vp.touch ? { hasTouch: true, isMobile: false } : {}),
    acceptDownloads: true,
  });
  if (seed) await context.addInitScript(([k, j]) => window.localStorage.setItem(k, j), seed);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  return { context, page, errors };
}

async function shoot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  console.log(`  shot: ${name}.png`);
}

// Walk forward through a workflow until the Review step is on screen.
async function gotoReview(page) {
  for (let i = 0; i < 12; i += 1) {
    const create = page.getByRole('button', { name: /Create Document|Update the printout/ });
    if (await create.count() > 0 && await create.first().isVisible().catch(() => false)) return true;
    const review = page.getByRole('button', { name: 'Go to Review' });
    if (await review.count() > 0 && await review.first().isVisible().catch(() => false)) {
      await review.first().click(); await page.waitForTimeout(350); continue;
    }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (await next.count() > 0 && await next.first().isVisible().catch(() => false)) {
      await next.first().click(); await page.waitForTimeout(350); continue;
    }
    return false;
  }
  return false;
}

async function openDraft(page) {
  await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.listItem button', { hasText: 'Open' }).first().click();
  await page.waitForTimeout(500);
}

async function startBlank(page, title) {
  await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
  await page.waitForTimeout(300);
  const row = page.locator('.listItem', { hasText: title }).first();
  await row.getByRole('button', { name: /Start|Open/ }).first().click();
  await page.waitForTimeout(500);
}

async function download(page, label) {
  const p = page.waitForEvent('download');
  await page.locator('button', { hasText: 'Download' }).click();
  const d = await p;
  const file = path.join(outDir, `${label}.pdf`);
  await d.saveAs(file);
  console.log(`  pdf:  ${label}.pdf  (suggested: ${d.suggestedFilename()})`);
  return file;
}

async function run(browser, vp) {
  const tag = vp.name;
  console.log(`\n=== ${tag} (${vp.width}x${vp.height}) ===`);

  // --- A. Outstanding-items state of the readiness checklist (blank doc).
  {
    const { context, page, errors } = await newPage(browser, vp);
    await startBlank(page, 'Employee Disciplinary Notice');
    if (await gotoReview(page)) await shoot(page, `${tag}-01-review-outstanding`);
    else console.log('  !! could not reach Review from a blank Disciplinary');
    if (errors.length) console.log(`  !! page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // --- B. Complete state -> draft PDF -> Mark Complete -> final PDF.
  {
    const fixture = readFileSync(path.join(__dirname, 'fixtures', 'disciplinary-normal.json'), 'utf8');
    const { context, page, errors } = await newPage(browser, vp, ['sdc.discipline.draft.v1', fixture]);
    await openDraft(page);
    if (!await gotoReview(page)) throw new Error('could not reach Review with the disciplinary fixture');
    await shoot(page, `${tag}-02-review-ready`);

    await page.locator('.reviewPrimaryAction button').first().click();
    await page.waitForSelector('.pdfReadyPanel', { timeout: 60000 });
    await shoot(page, `${tag}-03-document-ready-draft`);
    await download(page, `${tag}-disciplinary-DRAFT`);

    // Mark Complete: the inline action, then the confirm dialog.
    await page.locator('.reviewInlineAction button', { hasText: 'Mark Complete' }).first().click();
    await page.waitForTimeout(350);
    await shoot(page, `${tag}-04-mark-complete-confirm`);
    await page.locator('.dialogActions button.primary').click();
    await page.waitForTimeout(500);
    await shoot(page, `${tag}-05-completed-locked`);

    // PDF is now stale (status changed) -> Update Document -> final, unwatermarked.
    const update = page.getByRole('button', { name: /Update the printout/ });
    if (await update.count() > 0 && await update.first().isVisible().catch(() => false)) {
      await update.first().click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 60000 });
    }
    await shoot(page, `${tag}-06-document-ready-final`);
    await download(page, `${tag}-disciplinary-FINAL`);
    if (errors.length) console.log(`  !! page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // --- C. Incident keeps its own copy of the review panel.
  {
    const fixture = readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8');
    const { context, page, errors } = await newPage(browser, vp, ['sdc.incident.draft.v1', fixture]);
    await openDraft(page);
    if (await gotoReview(page)) await shoot(page, `${tag}-07-incident-review`);
    else console.log('  !! could not reach Incident Review');
    if (errors.length) console.log(`  !! page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // --- D. JSA review (unchanged pipeline, included as a no-regression check).
  {
    const { context, page, errors } = await newPage(browser, vp);
    await startBlank(page, 'Job Safety Analysis');
    if (await gotoReview(page)) await shoot(page, `${tag}-08-jsa-review`);
    else console.log('  !! could not reach JSA Review');
    if (errors.length) console.log(`  !! page errors: ${errors.join(' | ')}`);
    await context.close();
  }
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    for (const vp of VIEWPORTS) await run(browser, vp);
    await browser.close();
  } finally {
    killTree(server);
  }
  console.log('\nReview package written to tools/testing/output/review-package/');
}

main().then(() => {
  // The spawned vite grandchild keeps Node's event loop alive on Windows even
  // after server.kill(), so a passing run would otherwise hang. See the same
  // guard in every verify-*.mjs.
  process.exit(0);
}).catch(err => { console.error('review-package crashed:', err); process.exit(1); });
