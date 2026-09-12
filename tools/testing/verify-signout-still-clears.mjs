/* Signing out has to take the paperwork with it -- even now that leaving a
   page writes unsaved work down.

   Sign-out clears storage and then reloads, and a reload fires the same
   "this page is going away" events that tell autosave to write whatever it
   was holding. Get that wrong and signing out wipes a separation form and
   immediately puts it back, which is worse than never having cleared it.

   Runs against the DEV server so the real clearOnSignOut module can be
   called by URL -- the same module instance the running app holds. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 4357;
const BASE_URL = `http://localhost:${PORT}`;

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

async function main() {
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Half-written separation form, left inside the 900ms autosave window.
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Employee Separation' })
      .getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Kameron Grover');
    await page.waitForTimeout(1200); // let it save normally first
    const before = await page.evaluate(() => localStorage.getItem('sdc.separation.draft.v1'));
    check('A separation form is on the device to begin with',
      Boolean(before && before.includes('Kameron Grover')));

    // Now type MORE, so autosave is mid-wait, and sign out on top of it.
    await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Kameron Grover Jr');
    await page.evaluate(async () => {
      const m = await import('/src/shared/clearOnSignOut.js');
      m.clearWorkFromThisDevice();
      window.location.reload();
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => localStorage.getItem('sdc.separation.draft.v1'));
    check('Signing out mid-edit leaves nothing behind', !after,
      after ? `still there: ${after.slice(0, 120)}` : 'cleared');

    const templatesKept = await page.evaluate(() => {
      localStorage.setItem('sdc.jsa.templates.v1', '[]');
      return localStorage.getItem('sdc.jsa.templates.v1') !== null;
    });
    check('Templates are not paperwork and are not wiped', templatesKept);

    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
