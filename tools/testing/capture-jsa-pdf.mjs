/* Generate one real JSA PDF and save it, so two builds can be compared.

   The JSA's printed output is the riskiest thing in this repo to change
   by accident: it does not draw shapes, it photographs the screen with
   html2canvas and staples the photographs into a PDF, and that library
   has repeatedly rendered something other than what the live DOM says.
   The standing rule is that no print change is ever certified from a
   preview or a screenshot -- only from the real bytes.

   So this does the real export through the real UI, saves the file, and
   nothing else. Run it on two branches, then:

     node tools/testing/compare-pdf-bytes.mjs <dirA> <dirB>

     node tools/testing/capture-jsa-pdf.mjs <outDir>                  */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'jsa-capture');
mkdirSync(outDir, { recursive: true });

const PORT = 4392;
const BASE_URL = `http://localhost:${PORT}`;

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
  const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue JSA' }).click();
  await page.getByRole('tab', { name: /Finish/i }).first().click();
  await page.waitForTimeout(500);
  await page.locator('.signRoute', { hasText: 'On paper' }).click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /printout/i }).first().click();
  await page.locator('.pdfReadyPanel').waitFor({ timeout: 120000 });

  const download = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /download/i }).first().click();
  const file = await download;
  const saved = path.join(outDir, 'jsa-entergy-taps.pdf');
  await file.saveAs(saved);

  const bytes = readFileSync(saved).length;
  writeFileSync(path.join(outDir, 'capture.json'), JSON.stringify({ bytes, errors }, null, 2));
  console.log(`saved ${saved} (${bytes} bytes)`);
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  await browser.close();
  console.log('--- result ---');
} finally {
  killTree(server);
}
process.exit(0);
