// Find what makes the app die on the Tasks / Hazards step.
//
//   node tools/testing/reproduce-hazards-crash.mjs
//
// Kris Taute, 2026-09-14, first morning on the app: got as far as the
// hazards on a JSA, hit "Something went wrong", and every reload put him
// straight back on it. The details said "cannot read ... length of
// undefined". He was on a different job by the time we needed the stack,
// so this exists to find it without him.
//
// Reloading landing on the same crash is the important clue: it means the
// crash is in RENDER, off something saved on the device, not in a tap
// handler. PrintableJsa is always mounted, so one bad value in the draft
// takes down every screen, forever, on that phone only.
//
// So: poison one thing at a time, load the app for real, walk to the work
// step, and report which shapes kill it. Every case here is something the
// app could genuinely have written or half-written -- a value from an
// older build, a partial write when Android killed the tab, a list that
// came back as an object.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'crash');
mkdirSync(outDir, { recursive: true });

const PORT = 4372;
const BASE = `http://localhost:${PORT}`;
const DRAFT_KEY = 'sdc.jsa.draft.v4';

const base = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8'));

/* The values a JS object can hold that are NOT what the code expects, in
   the order they actually turn up in the wild: absent, null, an object
   where a list belongs, a string where a list belongs, a number. */
const BAD = [
  ['missing', undefined],
  ['null', null],
  ['object', { 0: 'a' }],
  ['string', 'some text'],
  ['number', 3],
  ['empty string', ''],
];

/* Every field of the draft the print path and the work step read. */
const FIELDS = [
  'taskRows', 'suggestionBundles', 'crewSignatures',
  'dailyTasks', 'hazardsSummary', 'controlsSummary',
  'signatureLineCount', 'siteType', 'signInMode',
  'jobSite', 'location', 'date', 'area', 'jobNumber',
];

/* Whole-draft shapes, and the other keys on the device. */
const WHOLE = [
  ['draft is null', DRAFT_KEY, 'null'],
  ['draft is an array', DRAFT_KEY, '[]'],
  ['draft is a string', DRAFT_KEY, '"hello"'],
  ['draft is a number', DRAFT_KEY, '7'],
  ['draft truncated mid-write', DRAFT_KEY, JSON.stringify(base).slice(0, 200)],
  ['templates is null', 'sdc.jsa.templates.v1', 'null'],
  ['templates is an object', 'sdc.jsa.templates.v1', '{}'],
  ['settings is null', 'sdc.settings.v2', 'null'],
  ['settings customQuick is null', 'sdc.settings.v2', '{"customQuick":null}'],
  ['settings customQuick lists are null', 'sdc.settings.v2', '{"customQuick":{"task":null,"hazard":null,"control":null}}'],
  ['quick recents is null', 'sdc.quick.recent.hazards', 'null'],
  ['quick recents is an object', 'sdc.quick.recent.hazards', '{}'],
  ['quick favorites is null', 'sdc.quick.favorites.hazards', 'null'],
  ['quick favorites is a string', 'sdc.quick.favorites.hazards', '"abc"'],
  ['quick recents (tasks) is null', 'sdc.quick.recent.daily-tasks', 'null'],
  ['quick favorites (tasks) is null', 'sdc.quick.favorites.daily-tasks', 'null'],
  ['quick recents (controls) is null', 'sdc.quick.recent.controls', 'null'],
  ['quick favorites (controls) is null', 'sdc.quick.favorites.controls', 'null'],
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

/* Kris was on an Android phone. Size matters here -- a phone renders
   things a desktop never mounts. */
const VIEWPORT = { width: 412, height: 915 };

async function run(browser, label, seed) {
  const context = await browser.newContext({
    viewport: VIEWPORT, hasTouch: true, isMobile: true,
  });
  await context.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
  }, seed);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e?.message || e)));

  let crashed = false;
  let reachedWork = false;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    /* Straight into the document, the way a man reopening a half-finished
       JSA does -- then on to the step he was actually on. */
    /* "Continue ›" on the JSA tile -- NOT "Finish what you started", which
       looks like the same thing and goes to My Work instead. The probe
       below exists because the first version of this harness clicked the
       wrong one and reported every shape clean. */
    const cont = page.getByRole('button', { name: /^Continue/i }).first();
    if (await cont.count()) { await cont.click().catch(() => {}); await page.waitForTimeout(600); }
    const step = page.locator('.stepNavRow', { hasText: /Tasks/i }).first();
    if (await step.count()) { await step.click().catch(() => {}); await page.waitForTimeout(700); }
    await page.waitForTimeout(400);

    /* Proof we actually got where Kris was. A harness that quietly never
       reaches the hazards step would report "clean" forever. */
    reachedWork = (await page.locator('.stepPanel', { hasText: /Hazard/i }).count()) > 0;

    crashed = (await page.locator('text=Something went wrong').count()) > 0;
    if (crashed) {
      /* The boundary catches the throw, so pageerror never fires -- but it
         prints the stack into its own details panel. That panel is the
         thing we could not get off Kris's phone. */
      /* textContent, not innerText: the panel is a collapsed <details>, so
         innerText comes back empty for the very thing we are here to read. */
      const detail = await page.evaluate(
        () => document.querySelector('details pre')?.textContent || '',
      ).catch(() => '');
      if (detail) errors.unshift(detail.split(/\r?\n/).slice(0, 4).join(' | '));
    }
  } catch (ex) {
    errors.push(`navigation: ${ex?.message || ex}`);
  }

  if (crashed || errors.length) {
    await page.screenshot({ path: path.join(outDir, `${label.replace(/[^a-z0-9]+/gi, '-')}.png`) })
      .catch(() => {});
  }
  await context.close();
  return { crashed, errors, reachedWork };
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const hits = [];
  let tested = 0;
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    const probe = await run(browser, 'navigation probe', { [DRAFT_KEY]: JSON.stringify({ ...base, status: 'draft' }) });
    console.log(probe.reachedWork
      ? 'Navigation reaches the Tasks / Hazards step. Good.'
      : 'WARNING: never reached the hazards step — every "clean" below is meaningless.');

    console.log('— one draft field at a time —');
    for (const field of FIELDS) {
      for (const [shapeName, value] of BAD) {
        const draft = { ...base, status: 'draft' };
        if (value === undefined) delete draft[field];
        else draft[field] = value;
        const label = `${field} = ${shapeName}`;
        tested += 1;
      const { crashed, errors } = await run(browser, label, { [DRAFT_KEY]: JSON.stringify(draft) });
        if (crashed || errors.length) {
          hits.push({ label, errors });
          console.log(`  CRASH  ${label}\n         ${errors[0] || '(error screen, no console error)'}`);
        }
      }
    }

    /* The shape that actually happens in the field: the list is a list,
       but one ITEM in it is half written. A suggestion bundle saved by an
       older build, a task row from a template that predates a field, a
       signature queued before its image finished. None of these are
       exotic -- they are what a draft looks like after the app changed
       shape underneath a document somebody had already started. */
    console.log('— a list that contains a half-written item —');
    const NESTED = [
      ['bundle with no hazards key', 'suggestionBundles', [{ id: 'b1', taskText: 'Excavation', controls: ['Barricade'] }]],
      ['bundle with no controls key', 'suggestionBundles', [{ id: 'b1', taskText: 'Excavation', hazards: ['Cave-in'] }]],
      ['bundle with null lists', 'suggestionBundles', [{ id: 'b1', taskText: 'Excavation', hazards: null, controls: null }]],
      ['bundle with nothing but an id', 'suggestionBundles', [{ id: 'b1' }]],
      ['bundle that is null', 'suggestionBundles', [null]],
      ['bundle with selected lists missing', 'suggestionBundles', [{ id: 'b1', taskText: 'Excavation', hazards: ['Cave-in'], controls: ['Barricade'] }]],
      ['task row with no step', 'taskRows', [{ hazards: 'Cave-in', controls: 'Barricade' }]],
      ['task row that is null', 'taskRows', [null]],
      ['task row of nulls', 'taskRows', [{ step: null, hazards: null, controls: null }]],
      ['task row holding lists', 'taskRows', [{ step: ['a'], hazards: ['b'], controls: ['c'] }]],
      ['signature with no image', 'crewSignatures', [{ signedAt: '2026-09-14T12:00:00Z' }]],
      ['signature that is null', 'crewSignatures', [null]],
      ['signature that is a string', 'crewSignatures', ['data:image/png;base64,xxx']],
    ];
    for (const [label, field, value] of NESTED) {
      const draft = { ...base, status: 'draft', [field]: value };
      tested += 1;
      const { crashed, errors } = await run(browser, label, { [DRAFT_KEY]: JSON.stringify(draft) });
      if (crashed || errors.length) {
        hits.push({ label, errors });
        console.log(`  CRASH  ${label}\n         ${errors[0] || '(error screen, no console error)'}`);
      }
    }

    console.log('— whole values on the device —');
    for (const [label, key, raw] of WHOLE) {
      const seed = { [DRAFT_KEY]: JSON.stringify({ ...base, status: 'draft' }) };
      seed[key] = raw;
      tested += 1;
      const { crashed, errors } = await run(browser, label, seed);
      if (crashed || errors.length) {
        hits.push({ label, errors });
        console.log(`  CRASH  ${label}\n         ${errors[0] || '(error screen, no console error)'}`);
      }
    }

    await browser.close();
    /* Reported the way core-checks.mjs reads a result, so this is a gate
       and not a script somebody has to remember to run. */
    console.log(`\n${tested - hits.length}/${tested} passed`);
    if (hits.length) {
      console.log(`${hits.length} CHECK(S) FAILED — a value saved on a device can still kill the app.`);
    }
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('harness crashed:', err); process.exit(1); });
