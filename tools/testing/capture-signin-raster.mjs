/* Rasterise a sign-in sheet that has real digital signatures on it, the
   same way the app does, and save the picture.

   Why this exists: the printed name under each signature was reported cut
   off at the bottom of its box in a real archived JSA -- and every check
   we had said it was fine. They said so because they measured the LIVE
   DOM, or printed through Chromium's own print engine. Neither is what
   makes the file. html2canvas is, and html2canvas paints text lower than
   the DOM says it will.

   The named sheet can only be exported through a signed-in account (the
   crew sign on their phones, it files itself, and the archived copy is
   what carries the names), which is awkward to drive here. So instead
   this loads the same page, then rasterises the very same element with
   the very same library at the very same scale the exporter uses. Same
   input, same renderer, same output.

     node tools/testing/capture-signin-raster.mjs <outDir>              */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'signin-raster');
mkdirSync(outDir, { recursive: true });

const PORT = 4397;
const BASE_URL = `http://localhost:${PORT}`;
/* 2.5 is what generateJsaPdf uses on a non-touch device. */
const SCALE = 2.5;

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => fetch(url).then(() => resolve()).catch(() => {
      if (Date.now() > deadline) reject(new Error('server never came up'));
      else setTimeout(tryOnce, 300);
    });
    tryOnce();
  });
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(BASE_URL, 25000);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  await ctx.addInitScript(
    j => window.localStorage.setItem('sdc.jsa.draft.v4', j),
    readFileSync(path.join(__dirname, 'fixtures', 'jsa-named-signin.json'), 'utf8'),
  );
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue JSA' }).click();
  await page.waitForTimeout(900);

  const names = await page.locator('.pdfExportRoot .attachedSigLineName').count();
  console.log(`sign-in sheet carries ${names} printed names`);

  await page.addScriptTag({ path: path.join(repoRoot, 'node_modules/html2canvas/dist/html2canvas.min.js') });
  await page.evaluate(async () => { if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} } });

  /* The exporter neutralises body line-height for the duration of the
     capture, because html2canvas's own font probe inherits it. Do the
     same, or this picture is not the picture the app makes. */
  const dataUrl = await page.evaluate(async (scale) => {
    const el = document.querySelector('.pdfExportRoot .signInPage');
    if (!el) return null;
    const prior = document.body.style.lineHeight;
    document.body.style.lineHeight = 'normal';
    try {
      const canvas = await window.html2canvas(el, {
        scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
      });
      return canvas.toDataURL('image/png');
    } finally {
      document.body.style.lineHeight = prior;
    }
  }, SCALE);

  if (!dataUrl) throw new Error('no sign-in page found in the export root');
  const out = path.join(outDir, 'signin-sheet.png');
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`saved ${out}`);
  await browser.close();
  console.log('--- result ---');
} finally {
  killTree(server);
}
process.exit(0);
