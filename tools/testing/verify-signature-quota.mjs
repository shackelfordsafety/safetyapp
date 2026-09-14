// What happens to a signature when the device has no room left?
//
//   node tools/testing/verify-signature-quota.mjs
//
// Fonzo, 2026-09-14, on a real separation for a man who has already left:
// "the signatures don't save when you hit save. When you go to another tab,
// it freaking disappears." The header on his screenshot said "Saved".
//
// "It says saved and then it is gone" has one obvious mechanism: the browser
// refusing the write. Signature images are the biggest thing this app puts
// in localStorage -- a full pad is tens to hundreds of KB as base64, there
// can be four on one separation, and six document drafts share one ~5MB
// box along with templates, settings and the cached job list.
//
// saveDraft() returns false when the write is refused and the autosave sets
// status 'error'. The question this answers is what a PERSON sees and, more
// importantly, whether the signature they just took is still there
// afterwards. A man who is told "error" in small grey text next to a big
// "Saved" he saw a second ago has not been told anything.
//
// This fills the device to near its limit first, then signs.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'quota');
mkdirSync(outDir, { recursive: true });

const PORT = 4424;
const BASE = `http://localhost:${PORT}`;
const KEY = 'sdc.separation.draft.v1';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

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

async function draw(page, canvas) {
  await canvas.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no pad on screen');
  const x0 = box.x + box.width * 0.15;
  const y0 = box.y + box.height * 0.5;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  /* A dense scribble on purpose: a real signature is not three straight
     lines, and the PNG it produces is what actually has to fit. */
  for (let i = 1; i <= 40; i += 1) {
    await page.mouse.move(
      x0 + i * (box.width * 0.02),
      y0 + Math.sin(i * 0.9) * (box.height * 0.34),
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Settings$/ }).first().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.locator('.simFill', { hasText: /Employee Separation/ }).first().click().catch(() => {});
    await page.waitForTimeout(1200);

    /* Fill the box up, leaving only a little room -- a device that has been
       in service a while with six drafts, templates and a job list on it. */
    const filled = await page.evaluate(() => {
      const CHUNK = 'x'.repeat(256 * 1024);
      let n = 0;
      try {
        for (; n < 40; n += 1) localStorage.setItem(`sdc.__ballast.${n}`, CHUNK);
      } catch { /* full */ }
      let free = 0;
      try {
        const probe = 'y'.repeat(64 * 1024);
        for (; free < 40; free += 1) localStorage.setItem(`sdc.__probe.${free}`, probe);
      } catch { /* full */ }
      for (let i = 0; i < free; i += 1) localStorage.removeItem(`sdc.__probe.${i}`);
      return { ballastMB: Math.round((n * 256) / 102.4) / 10, headroomKB: free * 64 };
    });
    console.log(`Device filled: ~${filled.ballastMB} MB of ballast, ~${filled.headroomKB} KB headroom left.`);

    await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const card = page.locator('.startDocTile', { hasText: /Employee Separation/i }).first();
    await card.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);

    // Find the signature step by its heading, NOT by an "Add signature"
    // button -- a pad that is already signed shows "Replace" instead, which
    // is how the previous sweep walked straight past it.
    const steps = page.locator('.stepNavRow');
    const total = await steps.count();
    let found = false;
    for (let s = 0; s < total; s += 1) {
      await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (await page.locator('.signaturePad').count()) { found = true; break; }
    }
    check('the signature step can be reached', found);
    if (!found) { await browser.close(); return; }

    const before = await page.evaluate(k => (localStorage.getItem(k) || '').length, KEY);

    const add = page.getByRole('button', { name: /^(Add signature|Replace)$/i }).first();
    await add.scrollIntoViewIfNeeded().catch(() => {});
    await add.click().catch(() => {});
    await page.waitForTimeout(400);
    const canvas = page.locator('canvas.signatureCanvas').first();
    await draw(page, canvas);
    const save = page.getByRole('button', { name: /^Save$/i }).first();
    if (await save.count()) { await save.click().catch(() => {}); await page.waitForTimeout(400); }

    const onScreenNow = await page.locator('img.signaturePreview').count();
    check('the signature appears on screen after signing', onScreenNow > 0);

    /* Well past the 900ms autosave debounce. */
    await page.waitForTimeout(2500);

    const state = await page.evaluate((k) => {
      const raw = localStorage.getItem(k) || '';
      let sigs = [];
      try {
        const parsed = JSON.parse(raw || 'null');
        if (parsed) sigs = Object.keys(parsed).filter(n => /SignatureData$/.test(n) && parsed[n]);
      } catch { /* unreadable */ }
      const header = document.querySelector('.builderHeader')?.innerText || '';
      return { bytes: raw.length, sigs, header: header.replace(/\s+/g, ' ').trim().slice(0, 120) };
    }, KEY);

    check('the signature was actually written to the device',
      state.sigs.length > 0 && state.bytes > before,
      `stored signatures: ${JSON.stringify(state.sigs)} · draft ${before} → ${state.bytes} bytes`);

    check('the screen does NOT claim it is saved when it is not',
      state.sigs.length > 0 || !/saved/i.test(state.header),
      `header reads: "${state.header}"`);

    await page.screenshot({ path: path.join(outDir, 'after-signing-on-full-device.png'), fullPage: true }).catch(() => {});

    /* And the question that actually matters: is it there when you come back? */
    await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const card2 = page.locator('.startDocTile', { hasText: /Employee Separation/i }).first();
    await card2.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    for (let s = 0; s < total; s += 1) {
      await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      if (await page.locator('.signaturePad').count()) break;
    }
    const survived = await page.locator('img.signaturePreview').count();
    check('the signature is still there after coming back', survived > 0,
      `${survived} on screen`);

    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED — a signature can be lost on a full device.`);
    process.exit(0);
  }
}

main().catch(err => { console.error('quota test crashed:', err); process.exit(1); });
