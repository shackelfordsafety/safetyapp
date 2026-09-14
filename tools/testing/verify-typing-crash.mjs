// Does TYPING into the hazards step kill the app?
//
//   node tools/testing/verify-typing-crash.mjs
//
// Kris says he was typing, not speaking. The voice test (verify-voice-crash)
// proved speech reaches the broken page planner; the claim that typing does
// NOT was reasoning, never a measurement, and reasoning that contradicts the
// person who was actually there is just wrong.
//
// The planner only misfires once content SETTLES -- the measuring rig has to
// catch up to the latest edit before its plan is used. So the thing to model
// is not typing, it is typing AND THEN STOPPING: finishing a line, pausing to
// think, tapping the next field, scrolling. That is what a man filling in a
// JSA actually does, and every one of those is a moment where the content
// stops changing.
//
// Run against a build WITHOUT the resolvePagePlan guard and this should
// crash. Against a build with it, it must not.

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

const PORT = 4396;
const BASE = `http://localhost:${PORT}`;

/* Real hazards, typed the way they get typed: one per line, a pause after
   each, enough of them to push the document past one page -- because the
   broken code is in the bit that counts continuation sheets, so a JSA with
   plenty of content is the one that reaches it. */
const HAZARDS = [
  'Cave in while trenching',
  'Struck by haul truck backing up',
  'Overhead power lines near the boom',
  'Silica dust from cutting',
  'Heat stress, no shade on site',
  'Slips on wet haul road',
  'Pinch points on the excavator bucket',
  'Falling material from the spoil pile',
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

const crashed = page => page.locator('text=Something went wrong').count().then(n => n > 0);
const detail = page => page.evaluate(
  () => document.querySelector('details pre')?.textContent || '',
).catch(() => '');

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const hits = [];
  let steps = 0;
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e?.message || e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const start = page.getByRole('button', { name: /^Start/i }).first();
    if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(700); }
    const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
    if (await blank.count()) { await blank.click().catch(() => {}); await page.waitForTimeout(800); }
    const step = page.locator('.stepNavRow', { hasText: /Tasks/i }).first();
    if (await step.count()) { await step.click().catch(() => {}); await page.waitForTimeout(800); }

    /* Inputs, not textareas: the three fields on this step are chip entry
       -- type an item, press Enter, it becomes a chip. That is the motion
       Kris was actually making. */
    const boxes = page.locator('.stepPanel input:not([type="search"]):not([type="checkbox"])');
    const boxCount = await boxes.count();
    console.log(`On the Tasks / Hazards step, ${boxCount} fields to type into.`);
    if (!boxCount) {
      console.log('WARNING: no fields found — this run proves nothing.');
      console.log('  heading:', JSON.stringify(await page.locator('.stepPanelHeader h3').allInnerTexts()));
      console.log('  textareas:', await page.locator('textarea').count(), 'inputs:', await page.locator('input').count());
      console.log('  textarea classes:', JSON.stringify(await page.locator('textarea').evaluateAll(ns => ns.map(n => n.className))));
    }

    const hazardBox = boxes.nth(Math.min(1, boxCount - 1));
    let typed = '';

    for (const line of HAZARDS) {
      /* One item at a time, committed with Enter, exactly like a man
         adding hazards on a phone keyboard. */
      await hazardBox.click({ timeout: 1500 }).catch(() => {});
      await hazardBox.fill(line).catch(() => {});
      await hazardBox.press('Enter').catch(() => {});
      steps += 1;

      /* THE PAUSE. This is the part that matters: the moment somebody
         stops to think is the moment the content settles and the rig
         catches up. Long enough to clear the 900ms autosave debounce. */
      await page.waitForTimeout(1500);

      if (await crashed(page)) {
        const d = (await detail(page)).split(/\r?\n/).slice(0, 4).join(' | ');
        hits.push({ where: `after typing "${line}" and pausing`, d });
        console.log(`  CRASH after typing ${JSON.stringify(line)} and pausing\n         ${d}`);
        await page.screenshot({ path: path.join(outDir, 'typing-crash.png'), fullPage: true }).catch(() => {});
        break;
      }

      /* Tapping into another field is its own settle, and it is what
         everybody does at the end of a line. */
      await boxes.nth(0).click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(800);
      steps += 1;
      if (await crashed(page)) {
        const d = (await detail(page)).split(/\r?\n/).slice(0, 4).join(' | ');
        hits.push({ where: `after moving to another field following "${line}"`, d });
        console.log(`  CRASH after moving fields following ${JSON.stringify(line)}\n         ${d}`);
        await page.screenshot({ path: path.join(outDir, 'typing-crash.png'), fullPage: true }).catch(() => {});
        break;
      }
      await hazardBox.click({ timeout: 1500 }).catch(() => {});
    }

    if (errors.length) console.log('console errors:', errors.slice(0, 3).join(' | '));
    await browser.close();
    console.log(`\n${steps - hits.length}/${steps} passed`);
    if (hits.length) console.log(`${hits.length} CHECK(S) FAILED — typing and pausing kills the app.`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('typing sweep crashed:', err); process.exit(1); });
