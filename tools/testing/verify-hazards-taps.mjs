// Tap everything on the Tasks / Hazards step and see what breaks.
//
//   node tools/testing/verify-hazards-taps.mjs
//
// Kris cleared his half-finished JSA, started a fresh one, got back to the
// hazards and it broke AGAIN at the same spot. That rules out old junk on
// his phone: something he TAPS on that screen does it, and Fonzo -- four
// devices, months of use -- never taps it.
//
// So this taps all of them. Every quick-add chip, in every category, in
// all three pickers, on a phone-sized screen, checking after each tap
// whether the app died. A crash names the exact chip.
//
// Two things the first version of this got wrong, both worth keeping
// written down:
//
//   1. The pickers are <details open={forceOpen || !isTouchPrimary}>, so
//      they start CLOSED on a phone and OPEN on a desktop. Kris and Fonzo
//      are not looking at the same screen. On touch they open from a
//      button labelled "Suggestions".
//   2. Tapping a task chip can open a suggestion sheet OVER the list,
//      which detaches every chip behind it. Without dismissing that sheet
//      the sweep silently stops after one tap and reports itself clean.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'crash');
mkdirSync(outDir, { recursive: true });

const PORT = 4386;
const BASE = `http://localhost:${PORT}`;

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

const crashed = page => page.locator('text=Something went wrong').count().then(n => n > 0);
const detail = page => page.evaluate(
  () => document.querySelector('details pre')?.textContent || '',
).catch(() => '');

async function openHazards(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e?.message || e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // A brand new JSA, exactly as a foreman would on his first morning.
  const start = page.getByRole('button', { name: /^Start/i }).first();
  if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(700); }
  const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
  if (await blank.count()) { await blank.click().catch(() => {}); await page.waitForTimeout(800); }
  const step = page.locator('.stepNavRow', { hasText: /Tasks/i }).first();
  if (await step.count()) { await step.click().catch(() => {}); await page.waitForTimeout(800); }

  // On touch the pickers are collapsed behind this.
  for (const o of await page.getByRole('button', { name: /^Suggestions$/i }).all()) {
    await o.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  return { page, errors };
}

/* Anything that opened over the list has to go before the next tap, or
   every chip behind it is unreachable and the sweep reports nothing. */
async function dismissOverlay(page) {
  if (!(await page.locator('.dialogOverlay').count())) return;
  const closers = page.getByRole('button', { name: /Cancel|Close|Not now|Keep|Skip|No thanks/i });
  if (await closers.count()) await closers.first().click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const hits = [];
  let tapped = 0;
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
    });
    const { page, errors } = await openHazards(context);

    const panels = page.locator('.quickPanel');
    const panelCount = await panels.count();
    console.log(`${panelCount} pickers open on the Tasks / Hazards step.`);
    if (!panelCount) console.log('WARNING: no pickers found — the sweep below proves nothing.');

    for (let p = 0; p < panelCount && !hits.length; p += 1) {
      const panel = panels.nth(p);
      const title = (await panel.locator('summary').first().innerText().catch(() => `picker ${p + 1}`)).trim();
      const select = panel.locator('select').first();
      const categories = await select.locator('option').allInnerTexts().catch(() => []);
      console.log(`\n${title} — ${categories.length} categories`);

      for (const category of categories) {
        if (hits.length) break;
        await select.selectOption({ label: category }).catch(() => {});
        await page.waitForTimeout(300);

        const count = await panel.locator('.quickChipWrap .chip').count();
        for (let i = 0; i < count; i += 1) {
          if (await crashed(page)) break;
          /* Re-queried every pass on purpose: the list re-renders after
             each tap, so a handle taken earlier is already stale. */
          const chip = panel.locator('.quickChipWrap .chip').nth(i);
          let label = '';
          try { label = (await chip.innerText({ timeout: 1500 })).replace(/\s+/g, ' ').trim(); } catch { continue; }
          if (!label) continue;

          try { await chip.click({ timeout: 2000 }); } catch { await dismissOverlay(page); continue; }
          tapped += 1;
          await page.waitForTimeout(140);

          for (const when of ['tapping', 'closing the sheet for']) {
            if (when === 'closing the sheet for') await dismissOverlay(page);
            if (await crashed(page)) {
              const d = (await detail(page)).split(/\r?\n/).slice(0, 4).join(' | ');
              hits.push({ label, category, title, when, d });
              console.log(`  CRASH ${when} ${JSON.stringify(label)} in ${category}\n         ${d}`);
              await page.screenshot({ path: path.join(outDir, 'tap-crash.png'), fullPage: true }).catch(() => {});
              break;
            }
          }
          if (hits.length) break;
        }
      }
    }

    if (errors.length) console.log('\nconsole errors:', errors.slice(0, 3).join(' | '));
    await browser.close();
    console.log(`\n${tapped - hits.length}/${tapped} passed`);
    if (hits.length) console.log(`${hits.length} CHECK(S) FAILED — a tap on the hazards step kills the app.`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('tap sweep crashed:', err); process.exit(1); });
