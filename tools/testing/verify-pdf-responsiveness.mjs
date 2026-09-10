// How long does "Make the printout" take, and is the app frozen while it
// runs?
//
// An outside tester's browser became unresponsive after clicking it, with
// "Input.dispatchMouseEvent timed out" after 23.4 seconds. That error means
// the browser's MAIN THREAD was blocked -- the page was too busy to accept
// a click. It was not established as an app bug, but PDF generation here
// rasterises the whole document with html2canvas, which is exactly the kind
// of work that blocks a main thread.
//
// This measures two things rather than arguing about them:
//   1. Wall-clock time from click to a finished PDF.
//   2. Whether the page can respond to input WHILE it runs -- tested by
//      driving a rAF-based counter and watching for gaps. A blocked main
//      thread cannot tick it.
//
// Why it matters in the field: if the thread is blocked, no spinner and no
// "Generating..." text can paint either. A superintendent on a five-year-old
// iPad taps the button and the app looks dead, so he taps it again.
//
// Usage: node tools/testing/verify-pdf-responsiveness.mjs
//   CPU_THROTTLE=4   simulate a slower device (1 = no throttling)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
mkdirSync(path.join(__dirname, 'output', 'pdfperf'), { recursive: true });

const PORT = 4357;
const THROTTLE = Number(process.env.CPU_THROTTLE || 1);
const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-medical-address.json'), 'utf8');

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
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
    await context.addInitScript((json) => {
      window.localStorage.setItem('sdc.jsa.draft.v4', json);
    }, draftJson);
    const page = await context.newPage();

    if (THROTTLE > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      console.log(`CPU throttled ${THROTTLE}x — standing in for an older iPad.\n`);
    }

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: /^Finish/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /On paper/ }).first().click();
    await page.waitForTimeout(500);

    /* A ticker driven by requestAnimationFrame. Every frame it records the
       gap since the last one. A responsive page ticks every ~16ms; a page
       whose main thread is blocked records one enormous gap covering the
       whole freeze. This is the actual question -- not "is it slow" but
       "is it frozen". */
    await page.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        window.__gaps.push(now - last);
        last = now;
        window.__raf = requestAnimationFrame(tick);
      };
      window.__raf = requestAnimationFrame(tick);
    });

    const started = Date.now();
    await page.getByRole('button', { name: /Make the printout|Create Document/ }).first().click();

    const ok = await page.locator('.pdfReadyPanel')
      .waitFor({ state: 'visible', timeout: 180000 })
      .then(() => true).catch(() => false);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const gaps = await page.evaluate(() => {
      cancelAnimationFrame(window.__raf);
      return window.__gaps;
    });

    const longest = gaps.length ? Math.max(...gaps) : 0;
    const overHalfSecond = gaps.filter(g => g > 500).length;
    const totalFrozen = gaps.filter(g => g > 500).reduce((a, b) => a + b, 0);

    console.log(`PDF finished:            ${ok}`);
    console.log(`Wall clock:              ${elapsed}s`);
    console.log(`Longest frozen stretch:  ${(longest / 1000).toFixed(2)}s`);
    console.log(`Freezes over 0.5s:       ${overHalfSecond}`);
    console.log(`Total time unresponsive: ${(totalFrozen / 1000).toFixed(2)}s`);

    /* Half a second is where a person decides a button did not work and
       presses it again. Anything past that is a freeze the user feels. */
    const verdict = longest > 500
      ? `\nThe page IS frozen while it generates — ${(longest / 1000).toFixed(2)}s with no frame drawn.\nA spinner cannot paint during that, and a man will tap the button again.`
      : '\nThe page stays responsive throughout.';
    console.log(verdict);

    await page.screenshot({ path: path.join(__dirname, 'output', 'pdfperf', 'after.png') });
    await browser.close();
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
