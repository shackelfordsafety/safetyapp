// The 5:00 PM / 5:00 AM guard, driven through the real UI.
//
// Fonzo published a night JSA with Time Expired set to 17:00 instead of
// 05:00. Because the start was 19:00, the expiry logic correctly rolled it
// to the NEXT day -- so the posting was good for 25 hours, and the board
// said only "good until 5:00 PM", which reads like this afternoon.
//
// Two runs against the same draft, one number changed:
//   05:00 -> a 10-hour night shift, publishes with no fuss
//   17:00 -> a 22-hour shift, stopped with a warning first
//
// No login needed: the check runs entirely on the device before anything
// is sent, which is the whole point of it.
//
// Usage: node tools/testing/verify-shift-window-warning.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'shiftwindow');
mkdirSync(outDir, { recursive: true });

const PORT = 4327;
const BASE_URL = `http://localhost:${PORT}`;

const base = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'jsa-medical-address.json'), 'utf8'));

function draftWith(timeExpired) {
  const today = new Date();
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return JSON.stringify({
    ...base,
    area: 'Entire site',
    date: iso,
    timeIssued: '19:00',   // night shift starts 7pm
    timeExpired,
  });
}

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

async function runCase(browser, label, timeExpired) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
  await context.addInitScript((json) => {
    window.localStorage.setItem('sdc.jsa.draft.v4', json);
  }, draftWith(timeExpired));

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue JSA' }).click();
  await page.getByRole('tab', { name: /^Finish/ }).click();
  await page.waitForTimeout(400);

  // The board route -- "On their phones" -- is the one with Publish on it.
  await page.getByRole('button', { name: /On their phones/ }).first().click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Publish to my board/ }).first().click();
  await page.waitForTimeout(1500);

  const dialog = page.getByRole('dialog', { name: 'Check the times' });
  const warned = await dialog.count() > 0;
  let text = '';
  if (warned) text = (await dialog.innerText()).replace(/\n+/g, ' | ');

  await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true });
  console.log(`\n[${label}] Time Expired ${timeExpired}`);
  console.log(`   warned: ${warned}`);
  if (warned) console.log(`   says:   ${text}`);
  if (errors.length) console.log('   PAGE ERRORS:', errors);

  await context.close();
  return { warned, text };
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();

    const good = await runCase(browser, 'correct-0500', '05:00');
    const bad = await runCase(browser, 'typo-1700', '17:00');

    console.log('\n--- result ---');
    const pass1 = good.warned === false;
    /* 22 hours, not 25. The warning measures the SHIFT now -- 19:00 to
       17:00 the next day -- instead of how long from this moment until the
       JSA closes, which is what it used to do and which changed with the
       time of day you ran this. That old measure is also why a real
       ten-hour night shift was being warned about. Fixed 2026-09-12. */
    const pass2 = bad.warned === true && /22[- ]hour/.test(bad.text);
    console.log(`${pass1 ? 'PASS' : 'FAIL'}  a real 10-hour night shift publishes without a warning`);
    console.log(`${pass2 ? 'PASS' : 'FAIL'}  the 17:00 typo is caught and named a 22-hour shift`);

    await browser.close();
    process.exitCode = pass1 && pass2 ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
