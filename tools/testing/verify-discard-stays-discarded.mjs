/* A document you got rid of has to STAY gone.

   Fonzo, 2026-09-12, looking at his phone at 4:32am: a JSA he had
   published to the board at 6:14 the previous morning was still sitting on
   Home under "Not finished", stamped "saved Sep 11 at 6:14 AM" -- the
   moment he published it. "this shouldn't be here bc it's a draft, i want
   to go to the JSA tab and it should just ask me if i wanna pull all
   relevant info from the previous one".

   The cause: autosave waits 900ms, and every path that threw a draft away
   deleted it from storage without cancelling the timer already armed. That
   timer still holds the whole document in its closure, so a moment later
   it wrote it straight back to the key that had just been removed. The
   document rose from the dead, and the app then insisted there was
   unfinished work where there was none.

   Every check below discards something and then WAITS past the autosave
   window before looking. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 4365;
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

const read = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const goto = (page, name) => page.getByRole('button', { name, exact: false }).first().click();

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    /* 1. THE JSA. Type, then clear it immediately -- inside the 900ms --
          which is the same shape as publishing: storage is emptied while a
          write is still in flight. */
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill('Bayou Crossing');
    /* No waits between these: the whole point is to delete the draft
       while a write is still armed, which is exactly the shape of
       publishing to the board. */
    page.once('dialog', d => d.accept());
    await page.getByRole('tab', { name: /Finish/i }).first().click();
    await page.getByRole('button', { name: 'Document Options' }).click();
    await page.getByRole('button', { name: /Clear/i }).first().click();
    await page.waitForTimeout(1600); // well past the autosave window
    const jsa = await read(page, 'sdc.jsa.draft.v4');
    check('JSA: a cleared draft does not write itself back',
      !jsa, jsa ? `came back: ${jsa.slice(0, 80)}` : 'stayed gone');

    /* 2. And the app must agree -- Home is where the ghost showed up. */
    await goto(page, 'Home');
    await page.waitForTimeout(500);
    /* The heading always renders -- it is the COUNT after it that said
       'NOT FINISHED - 1' on Fonzo's phone over a JSA he had already
       published. */
    const eyebrow = await page.locator('.homeSectionEyebrow', { hasText: /Not finished/i }).first().innerText();
    check('JSA: Home counts no unfinished work', /0s*$/.test(eyebrow.trim()), eyebrow.trim());
    const cards = await page.locator('.continueCard').count();
    check('JSA: and no draft card is left on Home', cards === 0, `${cards} card(s)`);

    /* 3. One of the four on the shared hook, same shape: start a new one
          while the old one is mid-save. */
    await goto(page, 'Documents');
    await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' })
      .getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Ghost Rider');
    await page.waitForTimeout(1200);
    await goto(page, 'Documents');
    page.once('dialog', d => d.accept()); // "start a new one? the current will be cleared"
    await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' })
      .getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1600);
    const disc = await read(page, 'sdc.discipline.draft.v1');
    check('Disciplinary: starting a new one really replaces the old one',
      !disc || !disc.includes('Ghost Rider'),
      disc && disc.includes('Ghost Rider') ? 'the old one came back' : 'gone');

    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
