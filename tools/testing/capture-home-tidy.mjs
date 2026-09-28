// Home (empty, and with two documents started) and Settings' version line,
// after the last tidiness pass (2026-09-28).
//
//   node tools/testing/capture-home-tidy.mjs [outDir]

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'home-tidy');
mkdirSync(outDir, { recursive: true });

const PORT = 4491;
const BASE = `http://localhost:${PORT}`;
const fx = n => readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

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
  for (const [name, seed] of [
    ['empty', {}],
    ['with-drafts', { 'sdc.jsa.draft.v4': fx('jsa-real-shape.json'), 'sdc.discipline.draft.v1': fx('disciplinary-normal.json') }],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
    await ctx.addInitScript(([s]) => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: 'dark' }));
      localStorage.setItem('sdc.a2hs.dismissed.home', '1');
    }, [seed]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `home-${name}.png`), fullPage: true });
    const zeroTiles = await page.locator('.glanceRow').count();
    console.log(`${name}: glance row ${zeroTiles ? 'shown' : 'hidden'}; "Not finished" tags: ${await page.locator('.startDocTileTag').count()}; My Work card: ${await page.locator('.accessRow', { hasText: 'My Work' }).count()}; ${errors.length ? `ERRORS ${errors.join(' | ')}` : 'no page errors'}`);
    if (name === 'empty') {
      await page.getByRole('button', { name: /Settings/ }).first().click();
      await page.waitForTimeout(800);
      const about = page.locator('.card', { hasText: 'For support' }).first();
      await about.scrollIntoViewIfNeeded();
      await about.screenshot({ path: path.join(outDir, 'settings-about.png') });
      console.log('about:', (await about.innerText()).replace(/\s+/g, ' '));
    }
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
} finally {
  killTree(server);
  process.exit(0);
}
