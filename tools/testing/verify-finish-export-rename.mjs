// THROWAWAY verification script (2026-08-19 "Review / Export" -> "Finish &
// Export" rename). Not part of the app build. Captures the step nav (with
// the new label visible alongside the other step labels) and the renamed
// step's own heading/subtext. Safe to delete once this review is done.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

const PORT = 4320;
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((draftJsonStr) => {
      window.localStorage.setItem('sdc.jsa.draft.v4', draftJsonStr);
    }, draftJson);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();

    await page.getByRole('tab').last().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'rename-stepnav-signatures.png'), fullPage: true });

    await page.getByRole('tab').last().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'rename-finish-export-step.png'), fullPage: true });

    console.log('Saved screenshots to', outDir);
    await browser.close();
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
