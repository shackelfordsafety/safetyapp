// The JSA Finish step as a first-timer sees it: both routes with their
// numbered "what happens next", then each one picked, then More options.
// iPad, light and dark.
//
//   node tools/testing/capture-jsa-finish.mjs [outDir]
//
// Fonzo, 2026-09-28: someone finished a JSA and asked "so what do i do" --
// "throwing a baby in a pool and hoping they figure it out."

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'jsa-finish');
mkdirSync(outDir, { recursive: true });

const PORT = 4479;
const BASE = `http://localhost:${PORT}`;
const JSA = readFileSync(path.join(__dirname, 'fixtures', 'jsa-real-shape.json'), 'utf8');

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => fetch(url).then(() => resolve()).catch(() => {
      if (Date.now() > deadline) reject(new Error('server not ready'));
      else setTimeout(tryOnce, 300);
    });
    tryOnce();
  });
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
    await ctx.addInitScript(([j, t]) => {
      localStorage.setItem('sdc.jsa.draft.v4', j);
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: t }));
    }, [JSA, theme]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('.stepNav button', { hasText: /FINISH/i }).first().click();
    await page.waitForTimeout(1000);
    const panel = page.locator('.stepStack').first();
    await panel.screenshot({ path: path.join(outDir, `${theme}-1-finish.png`) });
    if (theme === 'dark') {
      await page.locator('.signRoute', { hasText: 'On their phones' }).click();
      await page.waitForTimeout(700);
      await panel.screenshot({ path: path.join(outDir, `${theme}-2-phones.png`) });
      await page.locator('.signRoute', { hasText: 'On paper' }).click();
      await page.waitForTimeout(700);
      await panel.screenshot({ path: path.join(outDir, `${theme}-3-paper.png`) });
      await page.locator('.finishMore > summary').click();
      await page.waitForTimeout(500);
      await panel.screenshot({ path: path.join(outDir, `${theme}-4-more.png`) });
    }
    console.log(`${theme}: ${errors.length ? `PAGE ERRORS ${errors.join(' | ')}` : 'no page errors'}`);
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
} finally {
  killTree(server);
  process.exit(0);
}
