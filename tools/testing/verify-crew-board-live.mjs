// Does the crew page still work after the board became a lookup?
//
// This runs the REAL built app against the REAL Supabase project, exactly
// as a crew member's phone would, because the failure this guards against
// is invisible from a signed-in account: an anonymous read that the
// database now refuses. SQL proved the rule; this proves the page.
//
// Read-only. It loads a board and reports what a crew member would see.
// It never signs anything.
//
// Usage: node tools/testing/verify-crew-board-live.mjs <boardOwnerUuid>

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'crewboard');
mkdirSync(outDir, { recursive: true });

const PORT = 4363;
const owner = process.argv[2];
if (!owner) {
  console.error('Usage: node tools/testing/verify-crew-board-live.mjs <boardOwnerUuid>');
  process.exit(1);
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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failed = false;
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    const browser = await chromium.launch();
    // A phone, signed into nothing at all.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`http://localhost:${PORT}/#/sign/${owner}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const errorShown = await page.locator('.crewError, .crewFine').allInnerTexts().catch(() => []);
    const picks = await page.locator('.crewPick').count();
    const labels = await page.locator('.crewPick .crewPickTop').allInnerTexts().catch(() => []);
    const closedNotes = await page.locator('.crewPickClosed').allInnerTexts().catch(() => []);
    const openTags = await page.locator('.crewTag--open').count();
    const closedDisabled = await page.locator('.crewPick--closed[disabled]').count();
    const closedTotal = await page.locator('.crewPick--closed').count();

    console.log(`Boards a crew member can see:  ${picks}`);
    labels.forEach(l => console.log(`   - ${l.replace(/\n/g, ' | ')}`));
    console.log(`Open right now:                ${openTags}`);
    console.log(`Closed, and not tappable:      ${closedDisabled} of ${closedTotal}`);
    closedNotes.forEach(n => console.log(`   closed note: ${n}`));
    if (errorShown.length) console.log(`On-screen messages: ${errorShown.join(' | ')}`);
    console.log(`Console/page errors:           ${errors.length ? errors.join(' | ') : 'none'}`);

    await page.screenshot({ path: path.join(outDir, 'crew-board.png'), fullPage: true });

    const ok = picks > 0 && errors.length === 0 && closedDisabled === closedTotal;
    console.log(`\n${ok ? 'PASS' : 'FAIL'} — a crew member ${ok ? 'can still load the board' : 'CANNOT load the board'}`);
    failed = !ok;
    await browser.close();
  } finally {
    killTree(server.pid);
  }
  if (failed) process.exit(1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
