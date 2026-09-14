// Does talking into a hazards field kill the app?
//
//   node tools/testing/verify-voice-crash.mjs
//
// Fonzo's own hunch, and the best one going: Kris is on an Android phone,
// where the "Speak" button actually works. Fonzo is on an iPhone and a
// gaming PC and has never used it. If one screen behaves differently
// between them, that is the screen to suspect.
//
// A test run has no microphone, so this installs a fake SpeechRecognition
// -- the same object the browser hands the app -- and then feeds it the
// result shapes a real one produces, including the awkward ones: a result
// list with nothing in it, a result carrying no alternatives, a final
// chunk with no text, punctuation-only speech. Everything downstream of
// that is the real app: the real button, the real hook, the real field.
//
// This is about the three LIST fields (tasks, hazards, controls), because
// those take a different path through the code than the narrative ones --
// spoken text gets split into separate list items, and that splitting is
// where a shape can go wrong.

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

const PORT = 4390;
const BASE = `http://localhost:${PORT}`;

/* Each case is what the browser hands onresult. `results` mimics the
   SpeechRecognitionResultList the app loops over. */
const CASES = [
  ['ordinary speech', [{ t: 'Cave in hazard', final: true }]],
  ['two phrases', [{ t: 'Cave in. Struck by equipment.', final: true }]],
  ['interim then final', [{ t: 'cave', final: false }, { t: 'Cave in hazard.', final: true }]],
  ['no results at all', []],
  ['a result with no alternatives', [{ t: null, final: true, noAlternative: true }]],
  ['a final chunk with no text', [{ t: '', final: true }]],
  ['punctuation only', [{ t: '...', final: true }]],
  ['next item phrasing', [{ t: 'Cave in next hazard struck by next hazard falling objects', final: true }]],
  ['only a boundary', [{ t: '.', final: true }]],
  ['undefined transcript', [{ t: undefined, final: true }]],
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

/* Installed before any app code runs, so the app sees a browser that
   supports speech and takes the same path Kris's phone takes. */
const FAKE_SPEECH = () => {
  class FakeRecognition {
    constructor() {
      this.onresult = null; this.onerror = null; this.onend = null;
      /* Registered here rather than by wrapping the constructor -- the
         wrapper version reassigned window.SpeechRecognition to something
         that called itself, so the app saw no speech support at all and
         rendered the "use your keyboard mic" hint instead of a button. */
      window.__lastRecognition = this;
    }
    start() { window.__speechStarted = true; }
    stop() { if (this.onend) this.onend(); }
    abort() { if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  window.__fire = (chunks) => {
    const rec = window.__lastRecognition;
    if (!rec || !rec.onresult) return 'no recognition';
    const results = chunks.map((c) => {
      const alternatives = c.noAlternative ? [] : [{ transcript: c.t }];
      const r = { isFinal: Boolean(c.final), length: alternatives.length };
      alternatives.forEach((a, i) => { r[i] = a; });
      return r;
    });
    results.length = chunks.length;
    rec.onresult({ results, resultIndex: 0 });
    return 'fired';
  };
};

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const hits = [];
  let ran = 0;
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    for (const [label, chunks] of CASES) {
      const context = await browser.newContext({
        viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
      });
      await context.addInitScript(FAKE_SPEECH);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e?.message || e)));

      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const start = page.getByRole('button', { name: /^Start/i }).first();
      if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(600); }
      const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
      if (await blank.count()) { await blank.click().catch(() => {}); await page.waitForTimeout(700); }
      const step = page.locator('.stepNavRow', { hasText: /Tasks/i }).first();
      if (await step.count()) { await step.click().catch(() => {}); await page.waitForTimeout(700); }

      /* By class, not by accessible name -- the button's label changes to
         Stop while it is listening, so a name-based locator only works
         before the first tap. */
      const speak = page.locator('.voiceBtn');
      const speakCount = await speak.count();
      if (!speakCount) {
        const where = await page.locator(".stepPanelHeader h3").allInnerTexts().catch(() => []);
        const btns = (await page.locator("button").allInnerTexts().catch(() => [])).slice(0, 12);
        console.log(`  (no Speak button for "${label}") on: ${JSON.stringify(where)} buttons: ${JSON.stringify(btns)}`);
        await context.close();
        continue;
      }

      /* The middle one is Hazards -- a list field, which is the path that
         splits speech into separate items. */
      await speak.nth(Math.min(1, speakCount - 1)).click().catch(() => {});
      await page.waitForTimeout(400);
      const fired = await page.evaluate(c => window.__fire(c), chunks).catch(e => `threw: ${e.message}`);
      await page.waitForTimeout(500);
      ran += 1;

      const dead = await crashed(page);
      if (dead || errors.length) {
        const d = dead ? (await detail(page)).split(/\r?\n/).slice(0, 4).join(' | ') : errors[0];
        hits.push({ label, d });
        console.log(`  CRASH on ${label}\n         ${d}`);
        await page.screenshot({ path: path.join(outDir, `voice-${label.replace(/[^a-z0-9]+/gi, '-')}.png`), fullPage: true }).catch(() => {});
      } else {
        console.log(`  ok   ${label} (${fired})`);
      }
      await context.close();
    }

    await browser.close();
    console.log(`\n${ran - hits.length}/${ran} passed`);
    if (hits.length) console.log(`${hits.length} CHECK(S) FAILED — speaking into a field kills the app.`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('voice sweep crashed:', err); process.exit(1); });
