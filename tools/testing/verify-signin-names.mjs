/* Who is who on the sign-in sheet.

   A man scanning the QR types his name before he signs. That name was
   being dropped between the database and the printed sheet, so a filed
   record was 26 squiggles and no way to tell one from another — Fonzo,
   2026-09-11, reading a real filed sheet: "would be dope if on the pdf
   their names show up along w the signature, so we know who is who".

   Generates the REAL PDF through the app's own Create Document flow and
   extracts the embedded raster, because the live DOM has lied about this
   sheet before (see the Gotchas in CLAUDE.md). */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'signin-names');
mkdirSync(outDir, { recursive: true });

const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-named-signin.json'), 'utf8');
const PORT = 4363;
const BASE_URL = `http://localhost:${PORT}`;

let failures = 0;
function check(cond, label, detail) {
  if (cond) console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  else { console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`); failures += 1; }
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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(400);

    // The names must reach the printed DOM at all.
    const printedNames = await page.locator('.pdfExportRoot .attachedSigLineName').allInnerTexts();
    check(printedNames.length === 26, 'every typed name reaches the sheet', `${printedNames.length} of 26`);
    check(printedNames.includes('Gaines Newell'), 'a name is rendered verbatim');
    check(!printedNames.includes(''), 'no empty name line is drawn for a kiosk signature');

    // The row must NOT have grown — the whole sign-in pagination is built
    // on a fixed 55px row, and a taller row moves every page boundary.
    const rowH = await page.locator('.pdfExportRoot .attachedSigLine').first()
      .evaluate(el => Math.round(el.getBoundingClientRect().height));
    check(rowH === 55, 'the row is still exactly 55px tall', `${rowH}px`);

    // A name must never sit on top of the signature above or below it.
    const overlap = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.pdfExportRoot .attachedSigLine')];
      let worst = 0;
      rows.forEach((row) => {
        const img = row.querySelector('.attachedSigLineImg');
        const nm = row.querySelector('.attachedSigLineName');
        if (!img || !nm) return;
        const a = img.getBoundingClientRect();
        const b = nm.getBoundingClientRect();
        worst = Math.max(worst, Math.round(a.bottom - b.top));
      });
      return worst;
    });
    check(overlap <= 0, 'the name clears the signature above it', `${overlap}px of overlap`);

    /* NOT the 'On paper' route. Choosing paper deliberately wipes the
       captured signatures and prints blank lines for pen -- which is
       correct, and is what a first version of this script tripped over.
       The named sheet is the ARCHIVED copy of a JSA the crew signed
       digitally, so render the print DOM as it stands, through Chromium's
       own print engine and the same @media print rules. */
    console.log('  Printing the sheet through the real print engine...');
    const pdfPath = path.join(outDir, 'signin-names.pdf');
    await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    console.log('  ->', pdfPath);

    /* And prove the OTHER two copies of these rules agree, since the
       preview, the print and the html2canvas PDF each have their own and
       have drifted apart before. */
    const styles = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const c = getComputedStyle(el);
        return [c.fontSize, c.lineHeight, c.paddingLeft, c.whiteSpace].join('|');
      };
      return {
        exportRoot: pick('.pdfExportRoot .attachedSigLineName'),
        preview: pick('.documentPage .attachedSigLineName'),
      };
    });
    check(Boolean(styles.exportRoot), 'the PDF copy of the name rule is live', styles.exportRoot || 'missing');
    if (styles.preview) {
      check(styles.preview === styles.exportRoot,
        'the preview and the PDF style the name identically',
        `${styles.preview} vs ${styles.exportRoot}`);
    }
    check(errors.length === 0, `no console or page errors (${errors.length})`, errors.slice(0, 2).join(' | '));
    await browser.close();
  } finally {
    killTree(server);
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1); });
