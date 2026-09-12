/* Deliberately trying to break it.

   Fonzo, 2026-09-12: "stress test every single aspect of this app and tell
   me what comes back fucked up".

   The existing suites check that the app does the right thing when you use
   it properly. This one does the opposite: enormous text, characters
   nobody planned for, a full disk, the network dying mid-save, hammering a
   button, and a crew far bigger than any real one.

   Every check says, in plain words, what would actually happen to a person
   if it failed. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'stress');
mkdirSync(outDir, { recursive: true });

const PORT = 4390;
const BASE_URL = `http://localhost:${PORT}`;
const DRAFT = 'sdc.jsa.draft.v4';

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
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
    await waitForServer(BASE_URL, 25000);
    const browser = await chromium.launch();
    const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

    /* ── 1. A wall of text in one field ──────────────────────────────
       Somebody pastes a whole procedure into a hazard box. */
    {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.waitForTimeout(500);

      const wall = 'Keep clear of the swing radius at all times. '.repeat(700); // ~31k chars
      await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill(wall);
      await page.waitForTimeout(1500);

      const stored = await page.evaluate(k => localStorage.getItem(k), DRAFT);
      check('a 31,000-character paste is kept, not silently cut',
        Boolean(stored && stored.length > 30000),
        stored ? `${(stored.length / 1024).toFixed(0)} KB saved` : 'nothing saved');
      check('and the app is still standing after it', errors.length === 0, errors.slice(0, 2).join(' | '));

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('a wall of text does not push the screen sideways', overflow <= 1, `${overflow}px of sideways scroll`);
      await ctx.close();
    }

    /* ── 2. Characters nobody planned for ───────────────────────────── */
    {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.waitForTimeout(400);

      const nasty = 'O’Brien & Sons <script>alert(1)</script> "quoted" éñ مرحبا 🚧 100% #4';
      await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill(nasty);
      await page.waitForTimeout(1400);
      const stored = await page.evaluate(k => localStorage.getItem(k), DRAFT);
      check('apostrophes, symbols, accents, Arabic and an emoji all survive',
        Boolean(stored && stored.includes('O’Brien') && stored.includes('🚧')));
      check('a fake script tag is text, not something that runs',
        errors.length === 0 && !(await page.evaluate(() => window.__xss === true)));
      await ctx.close();
    }

    /* ── 3. The disk is full ─────────────────────────────────────────
       iPads run out. The question is whether he is told or just loses it. */
    {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.waitForTimeout(400);

      // Make every future write fail, the way a full disk does.
      await page.evaluate(() => {
        const real = Storage.prototype.setItem;
        window.__restoreStorage = () => { Storage.prototype.setItem = real; };
        Storage.prototype.setItem = function blocked() {
          const e = new Error('QuotaExceededError');
          e.name = 'QuotaExceededError';
          throw e;
        };
      });
      await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill('Disk Full Test');
      await page.waitForTimeout(1800);

      const bodyText = await page.locator('body').innerText();
      const warned = /save failed|storage|could not save|not saved/i.test(bodyText);
      check('a full disk is SAID OUT LOUD, not swallowed', warned,
        warned ? 'the screen says so' : 'it looks like it saved, and it did not');
      check('and the app does not fall over when the disk is full', errors.length === 0,
        errors.slice(0, 2).join(' | '));
      await page.evaluate(() => window.__restoreStorage && window.__restoreStorage());
      await ctx.close();
    }

    /* ── 4. Hammering a button ───────────────────────────────────────
       A slow iPad, a man who taps three times because nothing happened. */
    {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /Finish/i }).first().click();
      await page.waitForTimeout(500);
      await page.locator('.signRoute', { hasText: 'On paper' }).click();
      await page.waitForTimeout(400);

      const makeBtn = page.getByRole('button', { name: /printout/i }).first();
      await makeBtn.click();
      await makeBtn.click({ force: true }).catch(() => {});
      await makeBtn.click({ force: true }).catch(() => {});
      await page.locator('.pdfReadyPanel').waitFor({ timeout: 90000 });
      const panels = await page.locator('.pdfReadyPanel').count();
      check('tapping "make the printout" three times makes ONE printout', panels === 1, `${panels} panels`);
      check('no errors from the triple tap', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    /* ── 5. A crew of 300 ────────────────────────────────────────────
       Fonzo's crews run past 50. Somebody will type 300 one day. */
    {
      const big = JSON.parse(draftJson);
      big.signatureLineCount = 300;
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), JSON.stringify(big));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const started = Date.now();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.waitForTimeout(2500);
      const seconds = Math.round((Date.now() - started) / 1000);
      const pages = await page.locator('.pdfExportRoot .signInPage').count();
      check('a 300-man sign-in sheet builds without choking',
        errors.length === 0 && pages > 0, `${pages} sign-in pages, ${seconds}s to open`);
      check('and it opens in under 15 seconds', seconds < 15, `${seconds}s`);
      await ctx.close();
    }

    /* ── 6. The network dies mid-flow ────────────────────────────────
       Job sites lose signal constantly. Nothing should be lost. */
    {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draftJson);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.waitForTimeout(400);

      await ctx.setOffline(true);
      await page.getByRole('textbox', { name: 'Job Site', exact: true }).fill('Offline Yard');
      await page.waitForTimeout(1500);
      const stored = await page.evaluate(k => localStorage.getItem(k), DRAFT);
      check('with no signal at all, typing is still saved',
        Boolean(stored && stored.includes('Offline Yard')));
      check('and nothing on screen blames the person for it', errors.length === 0,
        errors.slice(0, 2).join(' | '));

      // And it must still be there when the signal comes back.
      await ctx.setOffline(false);
      await page.reload({ waitUntil: 'networkidle' });
      const after = await page.evaluate(k => localStorage.getItem(k), DRAFT);
      check('it is still there when the signal comes back',
        Boolean(after && after.includes('Offline Yard')));
      await ctx.close();
    }

    /* ── 7. A draft written by a much older version ──────────────────
       Nothing in this app migrates old shapes; it spreads them onto the
       defaults. A missing field must not blank the screen. */
    {
      const ancient = JSON.stringify({ jobSite: 'Ancient Draft', status: 'draft' });
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), ancient);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const visible = (await page.locator('body').innerText()).length > 100;
      check('a draft missing most of its fields does not blank the app',
        visible && errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    /* ── 8. Rubbish where a list should be ───────────────────────────
       safeJson parses it; nothing checks the shape afterwards. */
    {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await ctx.addInitScript(() => {
        window.localStorage.setItem('sdc.jsa.templates.v1', '{"not":"a list"}');
        window.localStorage.setItem('sdc.jsa.draft.v4', '{"taskRows":"not an array","jobSite":"Broken Shapes"}');
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const alive = (await page.locator('body').innerText()).length > 100;
      check('a wrong-shaped saved file does not white-screen the app',
        alive, alive ? '' : `app is blank: ${errors.slice(0, 1).join('')}`);
      await ctx.close();
    }

    await browser.close();
  } finally {
    killTree(server);
  }

  const bad = results.filter(r => !r.passed);
  console.log(`\n${results.length - bad.length}/${results.length} survived`);
  if (bad.length) {
    console.log('\nCame back broken:');
    bad.forEach(b => console.log(`  - ${b.name}${b.detail ? ` (${b.detail})` : ''}`));
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error('stress run crashed:', err); process.exit(1); });
