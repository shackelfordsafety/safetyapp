/* Does the last thing you typed actually get saved?

   Autosave waits 900ms before writing. Anything that ended that wait early
   used to throw the work away: leaving the document, closing the tab, the
   iPad going to sleep. Found by an outside reviewer, 2026-09-11.

   Every check below types something and then leaves IMMEDIATELY -- inside
   that 900ms window -- and then reads what is actually in storage, and what
   the app itself believes it has. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 4356;
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

const readKey = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const goto = (page, name) => page.getByRole('button', { name, exact: false }).first().click();

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    /* 1. A document on the shared hook (Disciplinary), left mid-form. */
    await goto(page, 'Documents');
    await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' })
      .getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Marcus Pridgen');
    await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('Ray Ferris');
    await goto(page, 'Home'); // no wait: the 900ms has NOT elapsed
    await page.waitForTimeout(400);
    const disc = await readKey(page, 'sdc.discipline.draft.v1');
    check('Disciplinary: typed, then left within 900ms -- still saved',
      Boolean(disc && disc.includes('Marcus Pridgen')),
      disc ? 'in storage' : 'nothing in storage at all');

    /* 2. And the app must SHOW it, not merely have it on disk. My Work is
          where a superintendent looks for what he has going. */
    await goto(page, 'My Work');
    await page.waitForTimeout(400);
    const myWork = await page.locator('main').innerText();
    check('Disciplinary: My Work lists it as still open',
      /STILL OPEN/i.test(myWork) && myWork.includes('Marcus Pridgen'));

    /* 3. Reopen it and confirm the typing is really in the form, not just a
          row in a list. */
    await page.getByRole('button', { name: 'Open', exact: true }).first().click();
    await page.waitForTimeout(500);
    const nameBack = await page.getByRole('textbox', { name: 'Employee Name', exact: true }).inputValue();
    check('Disciplinary: reopening it brings the typing back', nameBack === 'Marcus Pridgen', nameBack);

    /* 4. A reload -- which is what signing out does -- must not lose the
          last edit either. pagehide is the only warning a browser gives. */
    await page.getByRole('textbox', { name: 'Position', exact: true }).fill('Pipe Layer');
    await page.reload({ waitUntil: 'networkidle' });
    const afterReload = await readKey(page, 'sdc.discipline.draft.v1');
    check('Disciplinary: an edit survives the page reloading under it',
      Boolean(afterReload && afterReload.includes('Pipe Layer')),
      afterReload && afterReload.includes('Marcus Pridgen') ? 'earlier content intact too' : 'earlier content MISSING');

    /* 5. The JSA, which has its own hand-written autosave in main.jsx. */
    const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');
    await page.evaluate(j => localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill('Bayou Crossing Lift Station');
    await goto(page, 'Home');
    await page.waitForTimeout(400);
    const jsa = await readKey(page, 'sdc.jsa.draft.v4');
    check('JSA: job name typed, then left within 900ms -- still saved',
      Boolean(jsa && jsa.includes('Bayou Crossing Lift Station')));

    /* 6. Deleting must still delete. The flush holds work in memory, so the
          thing to prove is that it cannot put a deleted draft back. */
    await goto(page, 'My Work');
    await page.waitForTimeout(400);
    page.once('dialog', d => d.accept());
    await page.locator('.listItem', { hasText: 'Marcus Pridgen' })
      .getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForTimeout(400);
    await goto(page, 'Home');
    await page.waitForTimeout(600);
    const afterDelete = await readKey(page, 'sdc.discipline.draft.v1');
    check('Deleting a draft sticks -- the flush does not put it back',
      !afterDelete || !afterDelete.includes('Marcus Pridgen'),
      afterDelete ? 'a draft is present' : 'gone');

    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
