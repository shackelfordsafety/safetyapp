// Repro for a live-field bug report: a JSA downloaded after Kiosk signing +
// print produced sign-in pages with missing headers between the pages full
// of captured signatures. Unlike verify-jsa-pdf.mjs (which exercises the
// in-app html2canvas+pdf-lib "Create Document" pipeline), this drives the
// OTHER real path: `page.emulateMedia({ media: 'print' })` applies the raw
// `@media print` CSS exactly like an actual browser/iPad print or "Save as
// PDF" would (this is what `legacyBrowserPrint()`'s window.print() and the
// device's native print sheet both render), with zero html2canvas involved.
//
//   node tools/testing/verify-print-signin-repro.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'print-signin-repro');
mkdirSync(outDir, { recursive: true });

const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-kiosk-multipage-signin.json'), 'utf8');
JSON.parse(draftJson);

const PORT = 4361;
const BASE_URL = `http://localhost:${PORT}`;

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

async function main() {
  console.log('[1/5] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/5] Preview ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, draftJson);
    const page = await context.newPage();
    const consoleErrors = []; const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    console.log('[3/5] Loading fixture (34 kiosk signatures)...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(500);

    console.log('[4/5] Switching to print media emulation (raw @media print CSS, no html2canvas)...');
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);

    const sheets = await page.locator('.printSheet').all();
    console.log(`  Found ${sheets.length} .printSheet sections`);
    for (let i = 0; i < sheets.length; i += 1) {
      const box = await sheets[i].boundingBox();
      const cls = await sheets[i].locator('.printPage').first().getAttribute('class');
      console.log(`  sheet[${i}] class="${cls}" box=${JSON.stringify(box)}`);
    }

    // Full flow screenshot: this is exactly the continuous document a real
    // browser print/AirPrint would slice into physical pages -- if forced
    // page breaks between .printSheet sections are broken, it'll show here
    // as pages running together instead of each starting with its header.
    await page.screenshot({ path: path.join(outDir, 'full-print-flow.png'), fullPage: true });
    console.log('  shot: full-print-flow.png');

    // Also grab each VISIBLE .printSheet individually so a broken header is
    // unambiguous per logical page. (A correctly display:none phantom sheet,
    // e.g. the fixed pdfExportRoot bug this script was written to catch, has
    // no box and can't be screenshotted -- that's the fix working, not a
    // failure.)
    let shotCount = 0;
    for (let i = 0; i < sheets.length; i += 1) {
      const box = await sheets[i].boundingBox();
      if (!box) continue;
      await sheets[i].screenshot({ path: path.join(outDir, `sheet-${i + 1}.png`) });
      shotCount += 1;
    }
    console.log(`  shot: ${shotCount} visible sheet screenshot(s)`);

    // Check the actual CSS driving the page break between sheets.
    const breakInfo = await page.evaluate(() => {
      const sheets = Array.from(document.querySelectorAll('.printSheet'));
      return sheets.map(s => {
        const cs = getComputedStyle(s);
        return { breakAfter: cs.breakAfter, pageBreakAfter: cs.pageBreakAfter, breakInside: cs.breakInside };
      });
    });
    console.log('[5/5] Computed break CSS per .printSheet:', JSON.stringify(breakInfo, null, 2));

    if (consoleErrors.length || pageErrors.length) {
      console.log('!! errors:', JSON.stringify({ consoleErrors, pageErrors }, null, 2));
    }
    await browser.close();
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('repro crashed:', err); process.exit(1); });
