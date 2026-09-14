// Tap everything on the Tasks / Hazards step and see what breaks.
//
//   node tools/testing/verify-hazards-taps.mjs
//
// Kris cleared his half-finished JSA, started a fresh one, got back to the
// hazards and it broke AGAIN at the same spot. That rules out old junk on
// his phone: something he TAPS on that screen does it, and Fonzo -- four
// devices, months of use -- never taps it.
//
// So this taps all of them. Every quick-add chip in Tasks, Hazards and
// Controls, one at a time, on a phone-sized screen, checking after each
// one whether the app died. A crash names the exact chip.
//
// UNFINISHED, and honest about it: the chip list re-renders after every
// tap, so this currently gets one tap deep before its handles go stale. It
// is committed anyway because it already earned its keep -- it is what
// found that the quick-add panels start CLOSED on a phone and OPEN on a
// desktop, which is a real difference between Kris and Fonzo. Finish it by
// re-querying the chips by label each pass instead of holding handles.
// NOT in core-checks until it does.
//
// Runs in a single page on purpose: the point is the sequence a real man
// goes through, and it makes a hundred-odd taps take seconds instead of
// minutes.

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

async function openHazards(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e?.message || e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // Start a brand new JSA, exactly as a foreman would on his first morning.
  const start = page.getByRole('button', { name: /^Start/i }).first();
  if (await start.count()) { await start.click(); await page.waitForTimeout(700); }
  const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
  if (await blank.count()) { await blank.click(); await page.waitForTimeout(800); }

  const step = page.locator('.stepNavRow', { hasText: /Tasks/i }).first();
  if (await step.count()) { await step.click(); await page.waitForTimeout(800); }
  return { page, errors };
}

async function crashed(page) {
  return (await page.locator('text=Something went wrong').count()) > 0;
}

async function detail(page) {
  return page.evaluate(() => document.querySelector('details pre')?.textContent || '')
    .catch(() => '');
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

    let { page, errors } = await openHazards(context);
    const reached = await page.locator('.stepPanel', { hasText: /Hazard/i }).count();
    console.log(reached ? 'On the Tasks / Hazards step.' : 'WARNING: never reached the hazards step.');

    /* Open every quick-add picker first -- the chips only exist once the
       panel they live in is showing. */
    /* On a touch device every quick-add panel starts CLOSED --
       <details open={forceOpen || !isTouchPrimary}>. That is a real
       difference between Kris's phone and Fonzo's desktop, and it is why
       the first version of this sweep found nothing to tap. */
    const openers = await page.getByRole('button', { name: /^Suggestions$/i }).all();
    for (const o of openers) { await o.click().catch(() => {}); await page.waitForTimeout(200); }
    await page.waitForTimeout(600);

    const chips = page.locator('.quickChipWrap .chip');
    const total = await chips.count();
    console.log(`${total} chips to tap.`);

    for (let i = 0; i < total; i += 1) {
      if (await crashed(page)) break;
      const chip = chips.nth(i);
      let label = '';
      try { label = (await chip.innerText()).replace(/\s+/g, ' ').trim().slice(0, 60); } catch { continue; }
      if (!label) continue;
      try { await chip.click({ timeout: 2000 }); } catch { continue; }
      tapped += 1;
      await page.waitForTimeout(120);

      if (await crashed(page)) {
        const d = (await detail(page)).split(/\r?\n/).slice(0, 3).join(' | ');
        hits.push({ label, d });
        console.log(`  CRASH on tapping: ${JSON.stringify(label)}\n         ${d}`);
        await page.screenshot({ path: path.join(outDir, 'tap-crash.png'), fullPage: true }).catch(() => {});
        break;
      }
      /* A suggestion sheet may have opened over the list -- take the
         offered hazards and controls, which is what a man actually does,
         then carry on down the chips. */
      const accept = page.getByRole('button', { name: /Add (these|all)|Use these|Add to JSA/i }).first();
      if (await accept.count()) {
        await accept.click().catch(() => {});
        await page.waitForTimeout(250);
        if (await crashed(page)) {
          const d = (await detail(page)).split(/\r?\n/).slice(0, 3).join(' | ');
          hits.push({ label: `${label} → accepting its suggestions`, d });
          console.log(`  CRASH accepting suggestions for: ${JSON.stringify(label)}\n         ${d}`);
          await page.screenshot({ path: path.join(outDir, 'tap-crash.png'), fullPage: true }).catch(() => {});
          break;
        }
      }
    }

    if (errors.length) console.log('console errors:', errors.slice(0, 3).join(' | '));
    await browser.close();
    console.log(`\n${tapped - hits.length}/${tapped} passed`);
    if (hits.length) console.log(`${hits.length} CHECK(S) FAILED — a tap on the hazards step kills the app.`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('tap sweep crashed:', err); process.exit(1); });
