/* Whose settings are newer?

   Sync decides that by a timestamp this device writes down whenever its
   settings change. The app was writing that stamp every time it OPENED,
   which meant the newest device was simply whichever one you picked up
   last -- so an iPad out of a truck after a month could open, claim to be
   current, and push its month-old settings over everything else.

   Found by an outside reviewer, 2026-09-11. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 4359;
const BASE_URL = `http://localhost:${PORT}`;
const META = 'sdc.sync.meta.v1';

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error('server never came up'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

const stamp = page => page.evaluate(k => {
  try { return JSON.parse(localStorage.getItem(k) || '{}').settingsUpdatedAt || null; }
  catch { return null; }
}, META);

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // An iPad that last changed its settings a month ago.
    const OLD = '2026-08-11T09:00:00.000Z';
    await page.evaluate(({ k, old }) => {
      localStorage.setItem(k, JSON.stringify({ settingsUpdatedAt: old }));
    }, { k: META, old: OLD });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const afterOpen = await stamp(page);
    check('Opening the app does not claim the settings just changed',
      afterOpen === OLD, `stamp is ${afterOpen}`);

    // But actually changing one must still count.
    await page.getByRole('button', { name: 'Settings', exact: false }).first().click();
    await page.waitForTimeout(400);
    const toggled = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => /dark|light|theme/i.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    await page.waitForTimeout(600);
    const afterChange = await stamp(page);
    check('Changing a setting does stamp it as changed',
      toggled ? afterChange !== OLD : false,
      toggled ? `stamp is ${afterChange}` : 'no theme control found to click');

    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
