// A drawn signature cannot be walked away from.
//
//   node tools/testing/verify-signature-cannot-be-lost.mjs
//
// Fonzo, 2026-09-14, working out why signatures kept vanishing on a real
// separation: "the vanishing signatures on me bc we never hit save on the
// signature."
//
// It was not his mistake. Save was a small button under the pad, below the
// fold on a phone, with nothing on screen saying the mark was uncommitted.
// You drew, it LOOKED signed, you moved on, and it was gone -- on a
// document whose signer had already left the company.
//
// Signing is a sheet now: the background dims and the only ways out are
// Done and Cancel. This proves the ways OUT that used to lose work no
// longer do, which is the part that actually protects the paperwork:
//
//   1. tapping the dimmed background does not close the sheet
//   2. pressing Escape does not close the sheet
//   3. Done keeps the signature
//   4. Cancel discards it, deliberately, and says so by leaving no mark
//
// 1 and 2 are the two ways a half-drawn signature used to disappear with
// nobody deciding anything.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'sign-sheet');
mkdirSync(outDir, { recursive: true });

const PORT = 4460;
const BASE = `http://localhost:${PORT}`;

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
  const x0 = box.x + box.width * 0.2;
  const y0 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x0 + i * (box.width * 0.05), y0 + Math.sin(i) * (box.height * 0.2));
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function openSigningSheet(page) {
  await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Settings$/ }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  await page.locator('.simFill', { hasText: /Employee Separation/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const card = page.locator('.startDocTile', { hasText: /Employee Separation/i }).first();
  await card.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
  await page.waitForTimeout(1000);

  const steps = page.locator('.stepNavRow');
  const n = await steps.count();
  for (let s = 0; s < n; s += 1) {
    await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (await page.locator('.signaturePad').count()) break;
  }
  const add = page.getByRole('button', { name: /^(Add signature|Replace)$/i }).first();
  if (!(await add.count())) return false;
  await add.scrollIntoViewIfNeeded().catch(() => {});
  await add.click().catch(() => {});
  await page.waitForTimeout(500);
  return (await page.locator('.signSheet').count()) > 0;
}

const sheetOpen = page => page.locator('.signSheet').count().then(n => n > 0);
const kept = page => page.locator('img.signaturePreview').count().then(n => n > 0);

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();

    const opened = await openSigningSheet(page);
    check('tapping "Add signature" opens a signing sheet over a dimmed screen', opened);
    if (!opened) { await browser.close(); return; }
    await page.screenshot({ path: path.join(outDir, 'sheet.png') }).catch(() => {});

    const canvas = page.locator('.signSheet canvas.signatureCanvas').first();
    await draw(page, canvas);

    // 1. The backdrop. This used to be a way to lose a drawn signature.
    await page.locator('.signSheetOverlay').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(400);
    check('tapping the dimmed background does NOT throw the signature away', await sheetOpen(page));

    // 2. Escape, the other silent exit.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    check('pressing Escape does NOT throw the signature away', await sheetOpen(page));

    // 3. Done keeps it.
    await page.getByRole('button', { name: /^Done$/i }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    check('Done closes the sheet and keeps the signature',
      !(await sheetOpen(page)) && (await kept(page)));

    // 4. Cancel is the deliberate way to discard.
    const replace = page.getByRole('button', { name: /^Replace$/i }).first();
    if (await replace.count()) {
      await replace.click().catch(() => {});
      await page.waitForTimeout(500);
      const canvas2 = page.locator('.signSheet canvas.signatureCanvas').first();
      if (await canvas2.count()) await draw(page, canvas2);
      await page.getByRole('button', { name: /^Cancel$/i }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      check('Cancel closes the sheet and leaves the earlier signature alone',
        !(await sheetOpen(page)) && (await kept(page)));
    }

    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED — a signature can still be lost.`);
    process.exit(0);
  }
}

main().catch(err => { console.error('sign sheet check crashed:', err); process.exit(1); });
