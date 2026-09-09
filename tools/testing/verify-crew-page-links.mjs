// Screenshots the real public crew sign-in page and checks the live links
// on it: tap-to-call for the superintendent, and directions for the
// nearest medical facility.
//
// This drives the genuine page against the genuine database -- the crew
// page needs no login, which is the whole point of it, so unlike My Board
// it can be exercised end to end here. Requires a live publication on the
// board being pointed at.
//
// Usage: node tools/testing/verify-crew-page-links.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'crewlinks');
mkdirSync(outDir, { recursive: true });

const BOARD = process.env.BOARD_OWNER || '53ac3e37-efe3-45f6-b6ef-41be5a492afa';
const PORT = 4325;
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
    // A real phone viewport -- this page is never opened on a desktop.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(`${BASE_URL}/#/sign/${BOARD}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(outDir, '1-list.png'), fullPage: true });

    const pick = page.locator('.crewPick').first();
    if (await pick.count() === 0) {
      console.log('No live publication on this board — nothing to open.');
      await browser.close();
      return;
    }
    await pick.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, '2-jsa.png'), fullPage: true });

    const tels = await page.locator('a.jsaTelLink').evaluateAll(
      els => els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') })),
    );
    const maps = await page.locator('a.jsaMapLink').evaluateAll(
      els => els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') })),
    );

    console.log('Tap-to-call links:');
    tels.forEach(t => console.log(`   "${t.text}"  ->  ${t.href}`));
    console.log('Directions links:');
    maps.forEach(m => console.log(`   "${m.text}"  ->  ${m.href}`));

    /* The digit guard, checked only when the JSA on the board actually
       exercises it. A field holding TWO numbers ("911 / 601-555-0199")
       must stay plain text -- one merged 13-digit link would dial
       nonsense. A field holding just "911" must link. Reporting these
       unconditionally was misleading: against a real JSA that says only
       "911", both lines read false and looked like failures. */
    const bodyText = await page.locator('.jsaDoc').innerText();
    const twoNumberField = bodyText.match(/\d{3}\s*\/\s*[\d-]{7,}/);
    if (twoNumberField) {
      const merged = tels.some(t => t.text === twoNumberField[0]);
      console.log(`Guard: "${twoNumberField[0]}" left as plain text:`, !merged);
    }
    const bare911 = tels.find(t => t.text.trim() === '911');
    console.log('Guard: a bare "911" is dialable:', bare911 ? bare911.href : 'no bare 911 on this JSA');

    // Every list on the page, so the three-box layout is checked and not
    // just eyeballed.
    const boxes = await page.locator('.jsaBox').evaluateAll(els => els.map(e => ({
      title: e.querySelector('.jsaBoxTitle')?.textContent.trim(),
      count: e.querySelectorAll('.jsaBoxList li').length,
    })));
    console.log('Boxes:', boxes.map(b => `${b.title} (${b.count})`).join(', ') || 'none');

    if (errors.length) console.log('PAGE ERRORS:', errors);
    else console.log('No page errors.');

    await browser.close();
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
