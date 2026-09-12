/* The simulator fills documents, marks them, and is invisible unless asked for.

   Fonzo, 2026-09-12: "buttons that create a full jsa, i submit and make
   sure everything is clean".

   The check that matters most is the last one: a superintendent who never
   types ?sim=1 must never see this, because a seeded separation form in
   HR's queue looks exactly like a real person being let go. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 4371;
const BASE_URL = `http://localhost:${PORT}`;

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed });
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

const goSettings = page => page.getByRole('button', { name: 'Settings', exact: false }).first().click();

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();

    /* ── With the simulator on ── */
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE_URL}?sim=1`, { waitUntil: 'networkidle' });
    await goSettings(page);
    await page.waitForTimeout(900);

    const panel = page.locator('.simPanel');
    check('the panel is there when you ask for it', await panel.count() === 1);

    const runCode = (await panel.locator('.cardHeader strong').first().innerText()).trim();
    check('it shows a run code to mark things with', /^SIM-[A-Z0-9]{4}$/.test(runCode), runCode);

    check('it warns that this one is the real app',
      /real app/i.test(await panel.locator('.simState').innerText()));

    // Fill every document type and confirm each is marked and complete.
    const types = [
      ['JSA', 'sdc.jsa.draft.v4', 'jobSite'],
      ['Incident Report', 'sdc.incident.draft.v1', 'workplaceLocation'],
      ['Disciplinary Notice', 'sdc.discipline.draft.v1', 'employeeName'],
      ['Employee Separation', 'sdc.separation.draft.v1', 'employeeName'],
      ['Medical Event', 'sdc.medical.draft.v1', 'employeeName'],
      ['Uncontrolled Event', 'sdc.uncontrolled.draft.v1', 'location'],
    ];
    for (const [label, key, field] of types) {
      /* Filling reloads the page, so Settings has to be reopened each time
         and the panel re-found. That reload is the point: without it the
         seeded document is in storage but invisible. */
      await goSettings(page);
      await page.waitForTimeout(600);
      await page.locator('.simPanel .simFill', { hasText: label }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const stored = await page.evaluate(k => localStorage.getItem(k), key);
      const parsed = stored ? JSON.parse(stored) : null;
      check(`${label}: filled and marked`,
        Boolean(parsed && String(parsed[field] || '').startsWith(runCode)),
        parsed ? String(parsed[field]).slice(0, 40) : 'nothing stored');
    }

    // No signature images ride along in a seed.
    const anyImages = await page.evaluate(() => {
      const keys = ['sdc.jsa.draft.v4', 'sdc.incident.draft.v1', 'sdc.discipline.draft.v1',
        'sdc.separation.draft.v1', 'sdc.medical.draft.v1', 'sdc.uncontrolled.draft.v1'];
      return keys.some(k => (localStorage.getItem(k) || '').includes('data:image'));
    });
    check('no signature images are baked into the seeds', !anyImages);

    // Home should now show all six waiting.
    await page.getByRole('button', { name: 'Home', exact: false }).first().click();
    await page.waitForTimeout(700);
    /* Home shows at most four cards and counts the rest -- deliberate,
       MAX_VISIBLE in main.jsx. So the COUNT is what proves all six landed;
       asserting on cards would just be asserting the cap. */
    const eyebrow = await page.locator('.homeSectionEyebrow', { hasText: /Not finished/i }).first().innerText();
    check('Home counts all six as unfinished', /6s*$/.test(eyebrow.trim()), eyebrow.trim());
    const cards = await page.locator('.continueCard').count();
    check('and shows the first four, the rest counted', cards === 4, `${cards} cards`);

    // And the clear-down works.
    await goSettings(page);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Clear every draft/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => {
      const keys = ['sdc.jsa.draft.v4', 'sdc.incident.draft.v1', 'sdc.discipline.draft.v1',
        'sdc.separation.draft.v1', 'sdc.medical.draft.v1', 'sdc.uncontrolled.draft.v1'];
      return keys.filter(k => localStorage.getItem(k)).length;
    });
    check('clearing removes every one of them', left === 0, `${left} left`);
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    /* ── And, the one that matters: off by default ── */
    const plain = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    await plain.goto(BASE_URL, { waitUntil: 'networkidle' });
    await goSettings(plain);
    await plain.waitForTimeout(900);
    check('a superintendent who never asks for it never sees it',
      await plain.locator('.simPanel').count() === 0);

    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
