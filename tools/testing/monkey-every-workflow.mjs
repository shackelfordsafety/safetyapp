// Press everything, in every workflow, and see what falls over.
//
//   node tools/testing/monkey-every-workflow.mjs [--doc=jsa]
//
// Fonzo, 2026-09-14, after the hazards crash reached a real foreman on his
// first morning: "go through each and every workflow, pressing buttons, try
// all the combinations of different shit."
//
// The other suites check that the app does the right thing when it is used
// properly, or that one known bug stays fixed. This one has no opinion about
// what is supposed to happen: it fills every field, presses every control on
// every step of all six document types, and after each press asks one
// question -- is the app still alive?
//
// WHY THAT QUESTION AND NOT MORE. A crash is unambiguous and it is the thing
// that actually hurt somebody: the error boundary replaces the whole screen,
// every screen, and the work stops. Anything subtler needs a human to judge,
// and a monkey that guesses at "looks wrong" produces noise nobody reads.
//
// SAFETY. Runs against a local preview and never signs in, so nothing here
// can reach the company's real database. Anything that would publish or file
// is skipped by name, not by hoping it fails.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'monkey');
mkdirSync(outDir, { recursive: true });

const PORT = 4401;
const BASE = `http://localhost:${PORT}`;

const only = (process.argv.find(a => a.startsWith('--doc=')) || '').split('=')[1] || null;

/* Touch and pointer are genuinely different code paths in this app -- the
   quick-add pickers are <details open={forceOpen || !isTouchPrimary}>, so a
   desktop sees them open and a phone sees them shut. That difference is what
   hid Kris's crash from Fonzo across four devices, so the monkey has to walk
   both. */
const DESKTOP = process.argv.includes('--desktop');
const VIEWPORT = DESKTOP
  ? { viewport: { width: 1440, height: 900 } }
  : { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true };

/* The six, by the name on their start tile. */
const DOCS = [
  /* Not anchored: hasText matches a SUBSTRING of the tile's whole text,
     which for JSA reads 'JSA Start Templates'. An anchored ^JSA$ matched
     nothing and the workflow was skipped in silence. */
  ['jsa', /JSA/i],
  ['incident', /Incident Report/i],
  ['uncontrolledEvent', /Uncontrolled Event/i],
  ['medicalEvent', /Medical Event/i],
  ['disciplinary', /Disciplinary Notice/i],
  ['separation', /Employee Separation/i],
];

/* Never pressed. Each of these leaves the device -- a real publication on a
   real board, a real row in an append-only archive -- or throws away the
   document the monkey is in the middle of testing. */
const FORBIDDEN = /publish|file it|file to|send for review|submit|delete|discard|start blank|load template|sign out|create document|download/i;

/* Messy on purpose. Clean short strings have passed review here before while
   hiding real layout and parsing bugs, so: punctuation the parser splits on,
   an apostrophe, a very long run with no spaces, and a newline. */
const MESSY = [
  "Crew ran the 6\" line; tie-in at sta. 14+20 — watch the bore",
  "O'Brien's crew, 3rd shift",
  'A'.repeat(300),
  'line one\nline two; line three. line four',
  '12/31/2026',
  '281-555-0134',
];

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

const isDead = page => page.locator('text=Something went wrong').count().then(n => n > 0);
const deathNote = page => page.evaluate(
  () => document.querySelector('details pre')?.textContent || '',
).catch(() => '');

async function dismiss(page) {
  if (!(await page.locator('.dialogOverlay').count())) return;
  const closers = page.getByRole('button', { name: /Cancel|Close|Keep|Not now|No thanks|Skip|Go back/i });
  if (await closers.count()) await closers.first().click({ timeout: 1500 }).catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

async function fillEverything(page, viewportLabel) {
  const inputs = page.locator('.stepPanel input:not([type="checkbox"]):not([type="radio"]):not([type="search"]), .stepPanel textarea');
  const n = await inputs.count();
  for (let i = 0; i < n; i += 1) {
    const box = inputs.nth(i);
    const type = await box.getAttribute('type').catch(() => null);
    const value = type === 'date' ? '2026-12-31'
      : type === 'time' ? '06:30'
        : type === 'number' ? '12'
          : MESSY[i % MESSY.length];
    await box.fill(value).catch(() => {});
    await box.press('Enter').catch(() => {});
    await page.waitForTimeout(60);
  }
  /* The pause that settles the content -- the exact thing that made the
     page planner misfire. Every field-filling pass gets one. */
  await page.waitForTimeout(1200);
  return { filled: n, viewportLabel };
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const hits = [];
  let pressed = 0;
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    console.log(DESKTOP ? 'Walking as a DESKTOP (pointer).' : 'Walking as a PHONE (touch).');
    for (const [docId, tileName] of DOCS) {
      if (only && only !== docId) continue;
      const context = await browser.newContext(VIEWPORT);
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('pageerror', e => consoleErrors.push(String(e?.message || e)));

      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      /* By tile, then the button inside it. Matching the document's NAME as
         a button fails for JSA, whose tile shows the name as a heading and
         carries a separate "Start" -- and a monkey that silently skips the
         most-used workflow in the app is worse than no monkey. */
      const card = page.locator('.startDocTile', { hasText: tileName }).first();
      const tile = (await card.count())
        ? card.getByRole('button', { name: /^(Start|Continue)/i }).first()
        : page.getByRole('button', { name: tileName }).first();
      if (!(await tile.count())) {
        console.log(`${docId}: NO START TILE FOUND — this document was not tested`);
        await context.close();
        continue;
      }
      await tile.click().catch(() => {});
      await page.waitForTimeout(700);
      const blank = page.getByRole('button', { name: /Start Blank|Blank JSA|Start a blank/i }).first();
      if (await blank.count()) { await blank.click().catch(() => {}); await page.waitForTimeout(800); }

      const steps = page.locator('.stepNavRow');
      const stepCount = await steps.count();
      console.log(`\n${docId} — ${stepCount} steps`);

      for (let s = 0; s < stepCount; s += 1) {
        await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(700);
        const stepName = (await steps.nth(s).innerText().catch(() => `step ${s + 1}`)).replace(/\n/g, ' ').trim();

        await fillEverything(page, stepName);
        if (await isDead(page)) {
          const d = (await deathNote(page)).split(/\r?\n/).slice(0, 3).join(' | ');
          hits.push({ docId, stepName, what: 'filling in every field', d });
          console.log(`  DEAD after filling ${stepName}\n        ${d}`);
          await page.screenshot({ path: path.join(outDir, `${docId}-fill-${s}.png`), fullPage: true }).catch(() => {});
          break;
        }

        /* Now every control on the step, one at a time, skipping the ones
           that would leave the device or throw the document away. */
        const buttons = page.locator('.stepPanel button, .stepStack button');
        const bCount = await buttons.count();
        for (let b = 0; b < bCount; b += 1) {
          const btn = buttons.nth(b);
          let label = '';
          try { label = (await btn.innerText({ timeout: 1200 })).replace(/\s+/g, ' ').trim(); } catch { continue; }
          if (!label || FORBIDDEN.test(label)) continue;

          try { await btn.click({ timeout: 1500 }); } catch { await dismiss(page); continue; }
          pressed += 1;
          await page.waitForTimeout(180);

          if (await isDead(page)) {
            const d = (await deathNote(page)).split(/\r?\n/).slice(0, 3).join(' | ');
            hits.push({ docId, stepName, what: `pressing "${label}"`, d });
            console.log(`  DEAD pressing ${JSON.stringify(label)} on ${stepName}\n        ${d}`);
            await page.screenshot({ path: path.join(outDir, `${docId}-press-${s}-${b}.png`), fullPage: true }).catch(() => {});
            break;
          }
          await dismiss(page);
          if (await isDead(page)) {
            const d = (await deathNote(page)).split(/\r?\n/).slice(0, 3).join(' | ');
            hits.push({ docId, stepName, what: `closing what "${label}" opened`, d });
            console.log(`  DEAD closing what ${JSON.stringify(label)} opened\n        ${d}`);
            break;
          }
        }
        if (hits.some(h => h.docId === docId)) break;
      }

      /* Back out to Home and in again -- reopening a part-finished document
         is where a bad saved value shows itself. */
      if (!hits.some(h => h.docId === docId)) {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(900);
        if (await isDead(page)) {
          const d = (await deathNote(page)).split(/\r?\n/).slice(0, 3).join(' | ');
          hits.push({ docId, stepName: 'reopening the app', what: 'after filling this document in', d });
          console.log(`  DEAD reopening the app after ${docId}\n        ${d}`);
          await page.screenshot({ path: path.join(outDir, `${docId}-reopen.png`), fullPage: true }).catch(() => {});
        }
      }

      if (consoleErrors.length) {
        console.log(`  (console errors: ${consoleErrors.slice(0, 2).join(' | ').slice(0, 300)})`);
      }
      await context.close();
    }

    await browser.close();
    console.log(`\n${pressed - hits.length}/${pressed} passed`);
    if (hits.length) console.log(`${hits.length} CHECK(S) FAILED — the app died during normal use.`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('monkey crashed:', err); process.exit(1); });
