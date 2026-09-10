// Counts the taps it takes a crew member to sign, on a real phone-sized
// screen against the real page.
//
// The night this first went out to a real crew, nobody signed. Signing
// cost four taps -- "Sign this one", "Add signature", "Save", "Finish" --
// plus typing a name, and every one of those is a place to give up.
//
// So this measures the thing that actually matters: is the pad ready to
// draw on the moment you get there, and does the mark survive to submit
// without a Save step in between.
//
// Needs a live publication on the board it points at.
//
// Usage: node tools/testing/verify-crew-signing-taps.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'crewtaps');
mkdirSync(outDir, { recursive: true });

const BOARD = process.env.BOARD_OWNER || '53ac3e37-efe3-45f6-b6ef-41be5a492afa';
const PORT = 4337;
const BASE_URL = `http://localhost:${PORT}`;

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
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    let taps = 0;
    const tap = async (locator, what) => {
      await locator.click();
      taps += 1;
      console.log(`   tap ${taps}: ${what}`);
      await page.waitForTimeout(500);
    };

    await page.goto(`${BASE_URL}/#/sign/${BOARD}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);

    // Target OUR row by name. Picking .first() once grabbed a real live
    // JSA off the board instead -- a test must never touch real work.
    const pick = page.locator('.crewPick', { hasText: 'PAD TEST' }).first();
    if (await pick.count() === 0) {
      console.log('No live publication on this board — nothing to sign.');
      await browser.close();
      return;
    }

    console.log('Signing, counting taps:');
    await tap(pick, 'pick the area');
    await tap(page.getByRole('button', { name: 'Sign the JSA' }), '"Sign the JSA"');

    // The whole point: is the canvas already there, with no "Add signature"
    // button standing in front of it?
    const addBtn = page.getByRole('button', { name: /Add signature/i });
    const needsExtraTap = await addBtn.count() > 0;
    const canvas = page.locator('canvas.signatureCanvas');
    const padReady = await canvas.count() > 0;
    console.log(`\n   pad open on arrival: ${padReady}`);
    console.log(`   an "Add signature" tap still required: ${needsExtraTap}`);
    await page.screenshot({ path: path.join(outDir, '1-signing.png'), fullPage: true });

    if (!padReady) {
      console.log('\nFAIL  the pad is not ready to draw on.');
      await browser.close();
      process.exitCode = 1;
      return;
    }

    await page.getByRole('textbox', { name: /name/i }).first().fill('Chris Boyd');

    // Draw a real squiggle with a finger, the way a man actually would.
    // Scroll it into view FIRST. boundingBox() is viewport-relative, and
    // this form sits far down a long page -- drawing at the raw box
    // coordinates aimed below the fold and hit nothing, which looked like
    // the pad was broken when it was the harness that was.
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await canvas.boundingBox();
    await page.touchscreen.tap(box.x + 40, box.y + box.height / 2);
    for (let i = 0; i < 6; i += 1) {
      const x = box.x + 40 + i * (box.width - 80) / 6;
      const y = box.y + box.height / 2 + (i % 2 ? -22 : 22);
      await page.mouse.move(x, y);
    }
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.move(box.x + 40 + i * (box.width - 80) / 8, box.y + box.height / 2 + (i % 2 ? -25 : 25));
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const saveBtn = page.getByRole('button', { name: 'Save', exact: true });
    const needsSave = await saveBtn.count() > 0;
    console.log(`   a "Save" tap still required:            ${needsSave}`);

    const finish = page.getByRole('button', { name: /Finish/ });
    const finishEnabled = await finish.isEnabled();
    console.log(`   Finish is live straight after drawing:  ${finishEnabled}`);
    await page.screenshot({ path: path.join(outDir, '2-drawn.png'), fullPage: true });

    await tap(finish, '"Finish"');
    /* Wait for the confirmation, don't guess. A signature is tens of
       kilobytes going up a job-site connection; a fixed 2.5s timeout
       reported a failure once when the upload was simply still in flight
       and the row landed fine a moment later. */
    await page.locator('.crewDone').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

    const body = await page.locator('body').innerText();
    const signedIn = body.includes("You're signed in") || body.includes('signed in');
    console.log(`\n   signed in: ${signedIn}`);
    console.log(`   total taps (after typing the name): ${taps}`);
    await page.screenshot({ path: path.join(outDir, '3-done.png'), fullPage: true });

    console.log('\nPage errors:', errors.length ? errors : 'none');
    const ok = padReady && !needsExtraTap && !needsSave && signedIn && taps === 3 && errors.length === 0;
    console.log(ok ? '\nPASS  three taps and a name.' : '\nFAIL');
    await browser.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
