// Verification for the 2026-09-09 JSA print changes:
//   - "Site Contact Phone #" renamed to "Superintendent Phone #"
//   - the nearest-medical-facility ADDRESS now prints, as its own
//     full-width row in the info table
//
// The risk being tested is not "does the text appear" -- it is whether the
// extra info-table row pushes the task table down far enough to clip the
// bottom of a full main page (.documentPage is overflow:hidden, so an
// overflow is silent and invisible in the DOM). So this drives the real
// export and saves the real pages.
//
// Navigation matches the CURRENT four-step workflow (job / meeting / work
// / finish). verify-jsa-pdf.mjs still drives the old six-step one and no
// longer runs.
//
// Usage: node tools/testing/verify-jsa-medical-address.mjs
//   JSA_FIXTURE=<name.json>  fixture under tools/testing/fixtures/
//   JSA_OUTDIR=<dir>         output subdirectory under tools/testing/

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, process.env.JSA_OUTDIR || 'output/medaddr');
mkdirSync(outDir, { recursive: true });

const fixture = process.env.JSA_FIXTURE || 'jsa-medical-address.json';
const draftJson = readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8');
JSON.parse(draftJson);

const PORT = 4321;
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

async function main() {
  console.log('[1/6] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/6] Server ready. Fixture:', fixture);

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
    await context.addInitScript((json) => {
      window.localStorage.setItem('sdc.jsa.draft.v4', json);
    }, draftJson);

    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();

    // Screenshot the Job Info step so the renamed field label is reviewable
    // the same way a user would meet it.
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'step-job-info.png'), fullPage: true });

    console.log('[3/6] Going to Finish and choosing the paper route...');
    await page.getByRole('tab', { name: /^Finish/ }).click();
    await page.waitForTimeout(400);
    const paper = page.getByRole('button', { name: /On paper/ });
    if (await paper.count() > 0) await paper.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, 'step-finish.png'), fullPage: true });

    console.log('[4/6] Generating the real PDF...');
    page.once('dialog', d => d.accept());
    const makeBtn = page.getByRole('button', { name: /Make the printout|Create Document/ }).first();
    await makeBtn.click();
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 60000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.pdfReadyPanel button:has-text("Download")').first().click();
    const download = await downloadPromise;
    const pdfPath = path.join(outDir, 'jsa-generated.pdf');
    await download.saveAs(pdfPath);
    console.log('    Saved ->', pdfPath);

    // Reveal the off-screen export root and shoot the exact nodes
    // html2canvas rasterized.
    await page.addStyleTag({
      content: `
        .pdfExportRoot { position: static !important; left: 0 !important; top: 0 !important; }
        .pdfExportRoot .printPage { margin: 0 0 24px !important; box-shadow: 0 0 0 1px #ccc; }
        .toast { display: none !important; }
      `,
    });

    const pageEls = await page.locator('.pdfExportRoot .printPage').all();
    console.log(`[5/6] Capturing ${pageEls.length} export page(s)...`);
    const shots = [];
    for (let i = 0; i < pageEls.length; i += 1) {
      const cls = await pageEls[i].getAttribute('class');
      const kind = cls.includes('mainJsaPage') ? 'main'
        : cls.includes('continuationPage') ? 'continuation'
        : cls.includes('signInPage') ? 'signin' : 'other';
      const fpath = path.join(outDir, `page-${i + 1}-${kind}.png`);
      await pageEls[i].screenshot({ path: fpath });
      shots.push(fpath);
      console.log('    ' + fpath);
    }

    /* The clipping check. .documentPage is overflow:hidden, so content that
       runs past the page bottom simply disappears with no error anywhere.
       Compare each page's scrollHeight against its clientHeight -- any
       positive difference is content that did not make it onto the page. */
    const overflow = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.pdfExportRoot .printPage').forEach((el, i) => {
        out.push({
          page: i + 1,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          overflowPx: el.scrollHeight - el.clientHeight,
        });
      });
      return out;
    });
    console.log('[6/6] Overflow check (positive overflowPx = CLIPPED content):');
    overflow.forEach(o => console.log(`    page ${o.page}: ${o.clientHeight}px tall, content ${o.scrollHeight}px, overflow ${o.overflowPx}px`));

    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
      fixture, pdfPath, shots, overflow, consoleErrors, pageErrors,
    }, null, 2));

    if (consoleErrors.length || pageErrors.length) {
      console.log('CONSOLE/PAGE ERRORS:', JSON.stringify([...consoleErrors, ...pageErrors], null, 2));
    } else {
      console.log('No console or page errors.');
    }

    await browser.close();
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
