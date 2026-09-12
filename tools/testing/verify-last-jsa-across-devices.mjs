/* "Same info as last time?" on whichever device you picked up.

   Fonzo, 2026-09-12: "gang i need it across devices wherever you're
   signed in". He builds the JSA on his phone at 6am and picks up the iPad
   later. The snapshot that answers "same as last time?" lived in one
   browser's storage, so the second device offered nothing and he retyped
   the lot.

   TWO REAL BROWSER CONTEXTS, one account. Separate storage, separate
   everything -- the only thing they share is the login, which is exactly
   the situation. Nothing is faked: the phone publishes for real and the
   iPad is asked for real.

     node tools/testing/verify-last-jsa-across-devices.mjs <email> <password>
*/

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
  console.error('Usage: node tools/testing/verify-last-jsa-across-devices.mjs <email> <password>');
  process.exit(2);
}

const PORT = 4367;
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

async function signIn(page) {
  await page.getByRole('button', { name: 'Records', exact: false }).first().click();
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForTimeout(3000);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

    /* ── THE PHONE. Builds and publishes the morning JSA. ── */
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phone.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
    const phonePage = await phone.newPage();
    await phonePage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await signIn(phonePage);

    await phonePage.getByRole('button', { name: 'Home', exact: false }).first().click();
    await phonePage.getByRole('button', { name: 'Continue JSA' }).click();
    await phonePage.waitForTimeout(400);
    await phonePage.getByRole('textbox', { name: 'Job Site', exact: true }).fill('Crossdevice Yard');
    await phonePage.getByRole('tab', { name: /Finish/i }).first().click();
    // Choose the board route first -- the Publish button only exists
    // inside it. The other route prints for pen signing.
    await phonePage.locator('.signRoute').first().click();
    await phonePage.waitForTimeout(400);
    const publishBtn = phonePage.getByRole('button', { name: /Publish/i }).first();
    await publishBtn.waitFor({ timeout: 10000 });
    await publishBtn.click();
    await phonePage.waitForTimeout(4000); // publish, hand-off, and the sync it kicks

    const phoneDraft = await phonePage.evaluate(() => localStorage.getItem('sdc.jsa.draft.v4'));
    check('phone: the draft left the device on publish', !phoneDraft);

    /* ── THE IPAD. Never saw that JSA. Same account. ── */
    const ipad = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const ipadPage = await ipad.newPage();
    await ipadPage.goto(BASE_URL, { waitUntil: 'networkidle' });

    const beforeSignIn = await ipadPage.evaluate(() => localStorage.getItem('sdc.jsa.lastFinished.v1'));
    check('iPad: knows nothing about it before signing in', !beforeSignIn);

    await signIn(ipadPage);
    await ipadPage.waitForTimeout(4000); // the sync that runs on sign-in

    const pulled = await ipadPage.evaluate(() => localStorage.getItem('sdc.jsa.lastFinished.v1'));
    check('iPad: pulled the phone\'s last JSA down',
      Boolean(pulled && pulled.includes('Crossdevice Yard')),
      pulled ? 'arrived' : 'nothing arrived');

    /* Signatures must never have travelled. They belong to the
       publication, not to a sync row. */
    check('iPad: and no crew signatures came with it',
      Boolean(pulled) && !pulled.includes('data:image'),
      pulled && pulled.includes('data:image') ? 'SIGNATURE IMAGES LEAKED' : 'clean');

    /* And the whole point: the question, on the other device. */
    await ipadPage.getByRole('button', { name: 'Home', exact: false }).first().click();
    await ipadPage.waitForTimeout(500);
    await ipadPage.getByRole('button', { name: /^Start JSA/i }).first().click();
    await ipadPage.waitForTimeout(800);
    const ask = ipadPage.locator('.dialogPanel', { hasText: 'Same info as last time?' });
    check('iPad: starting a JSA asks about the phone\'s JSA', await ask.count() === 1);
    if (await ask.count()) {
      await ask.getByRole('button', { name: 'Yes, same info' }).click();
      await ipadPage.waitForTimeout(800);
      const site = await ipadPage.getByRole('textbox', { name: 'Job Site', exact: true }).inputValue().catch(() => '');
      check('iPad: and the job info comes through', site === 'Crossdevice Yard', site);
      const date = await ipadPage.getByRole('textbox', { name: 'Date', exact: true }).inputValue().catch(() => null);
      if (date !== null) {
        const today = new Date().toISOString().slice(0, 10);
        check('iPad: but the day starts fresh', date === today, `${date} vs ${today}`);
      }
    }

    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
