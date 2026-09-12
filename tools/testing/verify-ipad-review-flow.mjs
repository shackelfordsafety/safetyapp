// THROWAWAY inspection script (2026-08-19) -- just looking at how the new
// Review/Signatures/StepNav rendering actually looks on a real iPad
// viewport+touch emulation (Fonzo's field report: StepNav "obnoxious",
// Review readiness card "annoying", Signatures shows green/done when it
// should read as locked). Uses Playwright's built-in iPad device profile so
// useIsTouchPrimary() (which checks `(any-pointer: coarse)`, not viewport
// width) actually engages the touch-stacked layout.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

const completeDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

const PORT = 4325;
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
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, completeDraft);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'ipad-job-step.png') });

    await page.getByRole('tab').last().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'ipad-review-step.png') });

    await page.getByRole('tab').last().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'ipad-signatures-step.png') });

    await page.getByRole('tab').last().click();
    await page.waitForTimeout(300);
    await page.locator('.previewViewAllBtn').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'ipad-preview-pager.png') });

    await browser.close();
    console.log('Saved iPad screenshots to', outDir);
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Inspection script failed:', err);
  process.exit(1);
});
