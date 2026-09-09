// Proves the error boundary actually catches, using the real failure mode
// it was built for: a validly-parsed but wrong-shaped value read back out
// of localStorage. `taskRows` is expected to be an array and everything
// downstream calls .map on it; a number there throws during render, which
// before today blanked the entire app to white.
//
// Usage: node tools/testing/verify-error-boundary.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'errorboundary');
mkdirSync(outDir, { recursive: true });

const PORT = 4323;
const BASE_URL = `http://localhost:${PORT}`;
const POISON = JSON.stringify({ id: 'x', status: 'draft', jobSite: 'Entergy TAPS', taskRows: [null] });

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
    const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
    await context.addInitScript((poison) => {
      window.localStorage.setItem('sdc.jsa.draft.v4', poison);
      // An object where an array belongs -- the exact shape CLAUDE.md warns about.
      window.localStorage.setItem('sdc.jsa.templates.v1', '{"nope":1}');
    }, POISON);

    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // Force the crash by opening the JSA workflow, which is what actually
    // reads taskRows.
    const cont = page.getByRole('button', { name: /Continue JSA|Start a JSA|New JSA/ });
    if (await cont.count() > 0) { await cont.first().click(); await page.waitForTimeout(800); }

    const bodyText = await page.locator('body').innerText();
    const caught = bodyText.includes('Something went wrong');
    console.log('Boundary caught the crash:', caught);
    console.log('Screen is blank:', bodyText.trim().length === 0);
    await page.screenshot({ path: path.join(outDir, '1-caught.png'), fullPage: true });

    if (caught) {
      // First reload: plain reload path.
      await page.getByRole('button', { name: 'Reload the app' }).click();
      await page.waitForTimeout(900);
      const cont2 = page.getByRole('button', { name: /Continue JSA|Start a JSA|New JSA/ });
      if (await cont2.count() > 0) { await cont2.first().click(); await page.waitForTimeout(800); }

      // Second time round the escape hatch should now be offered.
      const rescue = page.getByRole('button', { name: /set the current document aside/i });
      const offered = await rescue.count() > 0;
      console.log('Escape hatch offered after a failed reload:', offered);
      await page.screenshot({ path: path.join(outDir, '2-stuck.png'), fullPage: true });

      if (offered) {
        await rescue.first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outDir, '3-rescued.png'), fullPage: true });

        // The poisoned draft must be preserved, not destroyed.
        const keys = await page.evaluate(() => Object.keys(window.localStorage));
        const backup = keys.find(k => k.startsWith('sdc.jsa.draft.v4.broken.'));
        const live = await page.evaluate(() => window.localStorage.getItem('sdc.jsa.draft.v4'));
        console.log('Poisoned draft backed up as:', backup || 'NOT BACKED UP');
        console.log('Live draft key cleared:', live === null);

        /* Reloading THIS page would re-run the harness's own addInitScript
           and re-poison storage before the app boots, which says nothing
           about the product. So take a snapshot of storage exactly as the
           rescue left it and replay it into a clean context instead --
           that is what the device genuinely looks like on next open. */
        const snapshot = await page.evaluate(() => {
          const out = {};
          for (let i = 0; i < window.localStorage.length; i += 1) {
            const k = window.localStorage.key(i);
            out[k] = window.localStorage.getItem(k);
          }
          return out;
        });

        const clean = await browser.newContext({ viewport: { width: 900, height: 800 } });
        await clean.addInitScript((snap) => {
          Object.entries(snap).forEach(([k, v]) => window.localStorage.setItem(k, v));
        }, snapshot);
        const page2 = await clean.newPage();
        const laterErrors = [];
        page2.on('pageerror', e => laterErrors.push(e.message));
        await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
        await page2.waitForTimeout(900);

        const recoveredText = await page2.locator('body').innerText();
        const recovered = !recoveredText.includes('Something went wrong') && recoveredText.length > 50;
        console.log('App starts normally after the rescue:', recovered);
        console.log('Backup still present on the device:',
          Object.keys(snapshot).some(k => k.includes('.broken.')));
        if (laterErrors.length) console.log('Errors on clean start:', laterErrors);
        await page2.screenshot({ path: path.join(outDir, '4-recovered.png'), fullPage: true });
      }
    }

    await browser.close();
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
