// Can a safety coordinator send an incident report up for review?
//
// This is the move that was missing. Safety deliberately cannot file a
// report -- the person who writes it should not be the person who decides
// it is final -- but without a way to send it up, that rule just reads as
// "you are blocked". This checks the button exists where a man would look
// for it, says where the document is going, and asks for a login rather
// than failing silently when there isn't one.
//
// It does NOT sign in. Driving a real submit needs a real account, and the
// end of that chain (a PM approving) needs a second one, so the last mile
// is Fonzo's to walk. What this proves is that the route is there and
// behaves when nobody is signed in, which is the state every field device
// is in.
//
// Usage: node tools/testing/verify-send-for-review.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'sendforreview');
mkdirSync(outDir, { recursive: true });

const PORT = 4364;
const draft = readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failed = false;
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
    await context.addInitScript((json) => {
      window.localStorage.setItem('sdc.incident.draft.v1', json);
    }, draft);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Continue Incident Report' }).click();
    await page.getByRole('tab', { name: /^Review & Export/ }).click();
    await page.waitForTimeout(700);

    /* The whole point of this pass: Submit is there BEFORE any printout
       has been made. It used to be Create Document, then Download, then
       Send -- three taps for one intention. */
    const sendBtn = page.getByRole('button', { name: /Submit for review/i });
    check('Submit is on the screen before any printout has been made',
      await sendBtn.count() > 0);
    check('it is not hidden behind "Create Document" first',
      await sendBtn.first().isEnabled());

    /* "Create Document" is gone from this screen -- it was a big primary
       button that still read as the main thing to do, sitting above
       Submit (Fonzo: "why does it still say create document tho"). Paper
       is secondary now and says so. */
    const wholeBefore = await page.locator('body').innerText();
    check('"Create Document" is no longer the primary action',
      !/Create Document/i.test(wholeBefore),
      /Create Document/i.test(wholeBefore) ? 'still on the page' : 'gone');

    // Make the printout via the secondary route, so the rest of the checks
    // see the ready panel too.
    await page.getByRole('button', { name: /paper copy first/i }).first().click();
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(400);

    const panel = await page.locator(".stepPanel").first().innerText();
    check('it says where the document is going, in the words of the job',
      /PM or an owner/i.test(panel), panel.split('\n').filter(l => /PM|owner|archive/i.test(l)).join(' | '));

    check('direct "File to the archive" is still hidden for a non-JSA document',
      !/File to the archive/i.test(panel));

    /* The author no longer gets to declare his own report finished. That
       button took the DRAFT watermark off a document nobody had approved,
       which is exactly what Fonzo did not want a super able to do. */
    const wholePage = await page.locator('body').innerText();
    check('the author cannot mark his own report complete any more',
      !/Mark Complete/i.test(wholePage),
      /Mark Complete/i.test(wholePage) ? 'Mark Complete is still on the page' : 'gone');
    check('a document completed under the old behaviour can still be unlocked',
      /Unlock for editing/i.test(wholePage) || !/marked complete/i.test(wholePage));

    await page.screenshot({ path: path.join(outDir, '01-ready-panel.png'), fullPage: true });

    // With nobody signed in it must ask for a login, not fail quietly.
    await sendBtn.first().click();
    await page.waitForTimeout(2500);
    const afterText = await page.locator("body").innerText();
    check('with no account it asks for a sign-in instead of failing silently',
      /Sign in to send this for review/i.test(afterText),
      afterText.split('\n').slice(-4).join(' | '));

    check('no console errors', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(outDir, '02-asks-to-sign-in.png'), fullPage: true });

    await browser.close();
  } finally {
    killTree(server.pid);
  }
  const bad = results.filter(r => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  failed = bad.length > 0;
  if (failed) process.exit(1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
