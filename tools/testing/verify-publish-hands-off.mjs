/* Publishing to the board has to take the JSA off the device.

   Fonzo, 2026-09-12: a JSA published at 6:14am was still on Home the next
   morning as unfinished, stamped with the publish time. The hand-off
   deleted the draft but never cancelled the autosave, so the timer wrote
   the whole thing back 900ms later.

   The other discard paths are covered by verify-discard-stays-discarded.
   This one exists because PUBLISHING is the path that actually bit him,
   it needs a real signed-in account, and "same helper, should be fine" is
   not evidence.

   Needs a throwaway account:
     node tools/testing/verify-publish-hands-off.mjs <email> <password>
   Delete whatever it publishes afterwards -- it posts to a real board. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node tools/testing/verify-publish-hands-off.mjs <email> <password>');
  process.exit(2);
}

const PORT = 4366;
const BASE_URL = `http://localhost:${PORT}`;
const DRAFT_KEY = 'sdc.jsa.draft.v4';

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
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Sign in, through the archive's sign-in form like a real person.
    await page.getByRole('button', { name: 'Records', exact: false }).first().click();
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForTimeout(3000);

    await page.getByRole('button', { name: 'Home', exact: false }).first().click();
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(400);

    /* Type something and publish IMMEDIATELY -- inside the 900ms. That is
       the exact shape of the bug: a write still in flight when the draft
       is taken away. */
    await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill('Publish Proof Site');
    await page.getByRole('tab', { name: /Finish/i }).first().click();
    await page.locator('.signRoute', { hasText: /crew|board|phone/i }).first().click()
      .catch(() => {});
    const publishBtn = page.getByRole('button', { name: /Publish/i }).first();
    await publishBtn.waitFor({ timeout: 10000 });
    await publishBtn.click();

    // Well past the autosave window, and past any retry.
    await page.waitForTimeout(3000);

    const after = await page.evaluate(k => localStorage.getItem(k), DRAFT_KEY);
    check('the draft is gone from the device after publishing',
      !after, after ? `still there: ${after.slice(0, 90)}` : 'gone');

    const snap = await page.evaluate(() => localStorage.getItem('sdc.jsa.lastFinished.v1'));
    check('and it was kept as the "same info as last time" snapshot',
      Boolean(snap && snap.includes('Publish Proof Site')));

    await page.getByRole('button', { name: 'Home', exact: false }).first().click();
    await page.waitForTimeout(800);
    const eyebrow = await page.locator('.homeSectionEyebrow', { hasText: /Not finished/i }).first().innerText();
    check('Home does not claim unfinished work', /0\s*$/.test(eyebrow.trim()), eyebrow.trim());
    check('no draft card is left on Home',
      await page.locator('.continueCard').count() === 0);

    /* And the offer he actually asked for, on the route he actually
       uses: Home -> Start JSA. It used to go straight to a blank form. */
    await page.getByRole('button', { name: 'Home', exact: false }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Start JSA/i }).first().click();
    await page.waitForTimeout(700);
    const ask = page.locator('.dialogPanel', { hasText: 'Same info as last time?' });
    check('starting a JSA asks whether to reuse the last one', await ask.count() === 1);
    if (await ask.count()) {
      const body = await ask.innerText();
      check('it names the job it would copy from', body.includes('Publish Proof Site'), body.split(String.fromCharCode(10))[1] || '');
      await ask.getByRole('button', { name: 'Yes, same info' }).click();
      await page.waitForTimeout(700);
      const site = await page.getByRole('textbox', { name: 'Job Site', exact: true }).inputValue().catch(() => '');
      check('saying yes brings the job info through', site === 'Publish Proof Site', site);
    }
    check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '));
    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
