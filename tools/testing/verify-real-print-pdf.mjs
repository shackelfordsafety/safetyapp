// Uses Chromium's REAL print/PDF engine (page.pdf()) -- not html2canvas, not
// a screenshot -- to see exactly what an actual browser/iPad "Print -> Save
// as PDF" produces from the raw @media print CSS, phantom off-screen
// .pdfExportRoot content included. This is the actual print pagination
// engine, so it's the only thing that can reveal whether off-canvas fixed-
// position content corrupts real page breaks the way screenshots can't.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const label = process.argv[2] || 'run';
const outDir = path.join(__dirname, 'output', 'real-print-pdf');
mkdirSync(outDir, { recursive: true });

const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-kiosk-multipage-signin.json'), 'utf8');

const PORT = 4362;
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
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, draftJson);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(500);

    const pdfPath = path.join(outDir, `${label}.pdf`);
    await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    console.log('Real print-engine PDF saved ->', pdfPath);

    await browser.close();
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('crashed:', err); process.exit(1); });
