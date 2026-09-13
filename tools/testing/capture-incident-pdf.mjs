/* Generate one real Incident Report PDF and save it, so two builds can be
   compared. Same job as capture-jsa-pdf.mjs, same reason -- the Incident
   export is the third html2canvas pipeline in this app, with its own
   separately calibrated compensations, and it must be shown unchanged by
   real bytes rather than assumed unchanged because the code edit looked
   small.

     node tools/testing/capture-incident-pdf.mjs <outDir>             */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'incident-capture');
mkdirSync(outDir, { recursive: true });

const PORT = 4393;
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
  const fixture = readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8');

  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(j => window.localStorage.setItem('sdc.incident.draft.v1', j), fixture);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab').last().click();
  await page.waitForTimeout(600);

  /* Incident's last step names its own button rather than sharing the
     JSA's wording -- same selector the existing incident checks use. */
  await page.locator('.reviewPrimaryAction button, button:has-text("Want a paper copy first?"), button:has-text("Update the printout")').first().click();
  await page.locator('.pdfReadyPanel').waitFor({ timeout: 180000 });

  const download = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /download/i }).first().click();
  const file = await download;
  const saved = path.join(outDir, 'incident-full.pdf');
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
