/* Screenshots of the whole submit-for-review chain, both sides of it.

   Fonzo, 2026-09-12: "can u make me an artifact of the submitting for
   review workflows, i wanna make sure the screens look good".

   Real screens, two real accounts, one real document going all the way
   from a superintendent's device to HR and into Records. Not mockups --
   the point is to look at what is actually there.

   Usage:
     node tools/testing/capture-review-flow.mjs <authorEmail> <hrEmail> <password>
*/

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'reviewflow');
mkdirSync(outDir, { recursive: true });

const [authorEmail, hrEmail, password] = process.argv.slice(2);
if (!authorEmail || !hrEmail || !password) {
  console.error('Usage: node tools/testing/capture-review-flow.mjs <authorEmail> <hrEmail> <password>');
  process.exit(2);
}

const PORT = 4370;
const BASE_URL = `http://localhost:${PORT}`;
const MARK = `Sim ${Date.now().toString().slice(-5)}`;

const shots = [];
async function shot(page, name, caption) {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
  shots.push({ file, caption });
  console.log(`  shot ${file} — ${caption}`);
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

async function signIn(page, email) {
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

    /* ── THE SUPERINTENDENT ─────────────────────────────────── */
    const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'separation-new-involuntary.json'), 'utf8'));
    fixture.employeeName = `${MARK} Boyd`;
    fixture.status = 'draft';
    fixture.completedAt = '';

    const authorCtx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
    await authorCtx.addInitScript(j => window.localStorage.setItem('sdc.separation.draft.v1', j), JSON.stringify(fixture));
    const author = await authorCtx.newPage();
    await author.goto(BASE_URL, { waitUntil: 'networkidle' });
    await signIn(author, authorEmail);

    await author.getByRole('button', { name: 'Home', exact: false }).first().click();
    await author.waitForTimeout(600);
    await shot(author, '01-home', 'Home — the separation form sitting under Not finished');

    await author.locator('.continueCard').first().getByRole('button').first().click();
    await author.waitForTimeout(700);
    await author.getByRole('tab', { name: /Review/i }).first().click();
    await author.waitForTimeout(600);
    await shot(author, '02-review', 'Review — the readiness checklist before anyone signs');

    await author.getByRole('tab').last().first().click();
    await author.waitForTimeout(800);
    await shot(author, '03-submit', 'Submit — one primary action, paper is secondary underneath');

    const submitBtn = author.getByRole('button', { name: /Submit for review/i }).first();
    await submitBtn.waitFor({ timeout: 10000 });
    await submitBtn.click();
    await author.waitForTimeout(4000);
    await shot(author, '04-handed-off', 'After submitting — it has left the device');

    await author.getByRole('button', { name: 'My Work', exact: false }).first().click();
    await author.waitForTimeout(900);
    await shot(author, '05-author-mywork', 'The author’s My Work — out for review, no draft left behind');

    /* ── HR ──────────────────────────────────────────────────── */
    const hrCtx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
    const hr = await hrCtx.newPage();
    await hr.goto(BASE_URL, { waitUntil: 'networkidle' });
    await signIn(hr, hrEmail);

    await hr.getByRole('button', { name: 'My Work', exact: false }).first().click();
    await hr.waitForTimeout(1500);
    await shot(hr, '06-hr-queue', 'HR opens My Work — it is waiting on her, with a count on the tab');

    /* The row itself opens it -- .odRowMain. There is no 'Pick it up'
       button, and the first version of this script silently caught the
       failure and shot the same screen three times. Not caught any more:
       a screenshot that is a copy of the last one is worse than a crash. */
    await hr.locator('.odRowMain').first().click();
    await hr.waitForTimeout(2500);
    await shot(hr, '07-hr-opened', 'HR has the real record open and can correct it');

    await hr.getByRole('tab').last().first().click();
    await hr.waitForTimeout(1200);
    await shot(hr, '08-hr-approve', 'HR sees Approve & file where the author saw Submit — never both');

    await browser.close();
    console.log(`\n${shots.length} screens -> ${outDir}`);
    console.log(`marker: ${MARK}`);
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('crashed:', err); process.exit(1); });
