// Walk the screens a person actually sees and photograph them.
//
//   node tools/testing/capture-screen-sweep.mjs > out.log 2>&1
//
// Not a pass/fail check -- monkey-every-workflow.mjs already presses every
// control looking for crashes, and it says so itself: anything subtler needs
// a human to judge. This is the other half. It puts every main screen in
// front of somebody in one place so "is it clean and understandable" can be
// answered by looking, instead of by reading code and guessing.
//
// Signed out on purpose. That is the half of the app that needs no account,
// it is what a superintendent sees, and it can never touch the company's
// real database from here.
//
// Port 4399 deliberately: every other script in this folder sits in the
// 4310-4375 range, several of them sharing, and a sweep is the last thing
// that should be fighting for a port.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const outDir = path.join(HERE, 'output', 'screen-sweep');
const PORT = 4399;
const BASE = `http://localhost:${PORT}/`;

const problems = [];

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 5000));

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, hasTouch: true });

    // A JSA with real content, so the busy screens are photographed busy
    // rather than empty -- an empty form hides every layout problem it has.
    /* SWEEP_BLANK=1 seeds nothing, so the same walk can be done on an empty
       document. Worth having both: a full one shows whether busy screens
       hold together, and an empty one is the only way to see that the step
       counter still reports honestly rather than just always saying the
       flattering number. */
    if (!process.env.SWEEP_BLANK) {
      const draft = readFileSync(path.join(HERE, 'fixtures', 'entergy-taps-draft.json'), 'utf8');
      await ctx.addInitScript(j => window.localStorage.setItem('sdc.jsa.draft.v4', j), draft);
    }

    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

    async function shot(name, note) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
      console.log(`  ${name}${note ? ` — ${note}` : ''}`);
    }

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot('01-home');

    /* Into the JSA, the screen that runs every morning. The tile says
       "Continue" when a draft exists and "Start" when one does not, and the
       heading on it is "JSA" rather than the full name -- an earlier version
       of this script looked for "Job Safety Analysis" and silently walked
       nowhere, photographing Home twice. */
    const tile = page.locator('.docTile, .homeTile, [class*="Tile"]').filter({ hasText: 'JSA' }).first();
    if (await tile.count()) {
      await tile.getByRole('button', { name: /Continue|Start/i }).first().click();
    } else {
      await page.getByRole('button', { name: /^Continue$/i }).first().click();
    }
    await page.waitForTimeout(1100);
    const tabCount = await page.getByRole('tab').count();
    if (!tabCount) console.log('  !! never reached the JSA workflow');

    const tabs = await page.getByRole('tab').all();
    for (let i = 0; i < tabs.length; i++) {
      await page.getByRole('tab').nth(i).click();
      await page.waitForTimeout(700);
      const label = (await page.getByRole('tab').nth(i).innerText()).split('\n')[0].trim();
      /* The counter in the step rail, read on every step. It is the one
         number on screen claiming to summarise progress, so it is worth
         reading rather than eyeballing off a screenshot. */
      const head = await page.locator('.stepNavHead').first().innerText().catch(() => '');
      const rows = await page.locator('.stepNavRow').allInnerTexts().catch(() => []);
      console.log('  step ' + (i + 1) + ' (' + label + ') -> "' + head + '"');
      console.log('     ' + JSON.stringify(rows.map(r => r.replace(/\n+/g, ' / ').trim())));
      await shot(`02-jsa-step${i + 1}`, label);
    }

    // Back out and look at the rest of the app.
    const back = page.getByRole('button', { name: /Start Options|←/ }).first();
    if (await back.count()) { await back.click(); await page.waitForTimeout(600); }

    // Documents is a Workspace card on Home, not a sidebar item.
    const home = page.getByRole('button', { name: /^Home$/ }).first();
    if (await home.count()) { await home.click(); await page.waitForTimeout(800); }
    const docsCard = page.getByRole('button', { name: /Documents/ }).first();
    if (await docsCard.count()) { await docsCard.click(); await page.waitForTimeout(1000); await shot('03-documents'); }

    for (const [name, rx] of [
      ['04-my-work', /^My Work$/],
      ['05-signin-board', /^Sign-In$/],
      ['06-records', /^Records$/],
      ['07-settings', /^Settings$/],
    ]) {
      const btn = page.getByRole('button', { name: rx }).first();
      if (!(await btn.count())) { console.log(`  !! no nav button for ${name}`); continue; }
      await btn.click();
      await page.waitForTimeout(1100);
      await shot(name);
    }

    if (errors.length) {
      problems.push(...errors);
      console.log(`\n!! ${errors.length} console/page error(s):`);
      [...new Set(errors)].slice(0, 12).forEach(e => console.log(`   ${e}`));
    } else {
      console.log('\nno console or page errors on any screen');
    }

    await ctx.close();
  } catch (err) {
    console.error('\n!! FAILED: ' + (err?.message || err));
  } finally {
    await browser.close().catch(() => {});
    killTree(server);
    console.log(`\nscreens in ${outDir}`);
    process.exit(0);
  }
}

main().catch(e => { console.error('crashed:', e); process.exit(1); });
