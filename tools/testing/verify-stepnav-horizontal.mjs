// Quick visual check for the 2026-08-29 StepNav layout fix: full-width
// horizontal bar above the workflow instead of a narrow vertical/cramped
// left column, on both desktop and iPad-landscape widths (the exact device
// that triggered the field report -- 1024-1366px wide, touch, previously
// hit the worst case: horizontal scroll strip crammed into a 260px column).
//   node tools/testing/verify-stepnav-horizontal.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'stepnav-horizontal');
mkdirSync(outDir, { recursive: true });

const PORT = 4328;
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
  console.log('Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();

    // Desktop, mouse
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Job Safety Analysis' }).getByRole('button', { name: 'Start' }).click();
      await page.getByRole('button', { name: 'Start Blank', exact: false }).click();
      await page.waitForSelector('.stepNav');
      await page.screenshot({ path: path.join(outDir, 'desktop-1440.png'), fullPage: false });
      await context.close();
    }

    // iPad Pro landscape, touch -- the exact device from the field report
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Job Safety Analysis' }).getByRole('button', { name: 'Start' }).click();
      await page.getByRole('button', { name: 'Start Blank', exact: false }).click();
      await page.waitForSelector('.stepNav');
      await page.screenshot({ path: path.join(outDir, 'ipad-landscape-1366.png'), fullPage: false });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`iPad landscape horizontal overflow: ${overflow}px (should be <=1)`);
      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
