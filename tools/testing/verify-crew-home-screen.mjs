// "Add to Home Screen" on the crew page must save the JSA page, not the
// app's home screen.
//
// Reported from the field 2026-09-10: a crew member saved the sign-in link
// and got the Safety Documentation Center instead. Cause is the web app
// manifest -- iOS reads its start_url ("./") and bookmarks that rather than
// the address on screen.
//
// What this can and cannot prove: it confirms the crew page advertises NO
// manifest (so Safari has nothing to override the current URL with) and
// that the titles read sensibly. It cannot drive iOS's actual Add to Home
// Screen dialog -- that last mile needs a real iPhone.
//
// Usage: node tools/testing/verify-crew-home-screen.mjs
//   LIVE_URL=<origin/path>  check the deployed site instead of a local build

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const BOARD = process.env.BOARD_OWNER || '53ac3e37-efe3-45f6-b6ef-41be5a492afa';
const LIVE = process.env.LIVE_URL || '';
const PORT = 4343;

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

async function look(page, base, label) {
  await page.goto(`${base}#/sign/${BOARD}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const crew = await page.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null,
    title: document.title,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') || null,
    hash: window.location.hash,
    onCrewPage: Boolean(document.querySelector('.crewWrap')),
  }));

  // And the real app must be unchanged -- it still wants to be installable.
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const app = await page.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null,
    title: document.title,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') || null,
  }));

  console.log(`\n[${label}]`);
  console.log('  crew page:');
  console.log(`    on the crew page:        ${crew.onCrewPage}`);
  console.log(`    hash kept:               ${crew.hash}`);
  console.log(`    manifest advertised:     ${crew.manifest ?? 'none'}`);
  console.log(`    page title:              ${crew.title}`);
  console.log(`    iOS home-screen name:    ${crew.appleTitle}`);
  console.log('  the app itself:');
  console.log(`    manifest advertised:     ${app.manifest ?? 'none'}`);
  console.log(`    iOS home-screen name:    ${app.appleTitle}`);

  const ok = crew.onCrewPage
    && crew.manifest === null
    && crew.hash.includes('/sign/')
    && /Sign the JSA/i.test(crew.title)
    && crew.appleTitle === 'Sign JSA'
    && app.manifest !== null
    && app.appleTitle === 'Safety Docs';
  console.log(ok ? '  PASS' : '  FAIL');
  return ok;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  let ok = true;

  if (LIVE) {
    ok = await look(page, LIVE, 'deployed site');
    await browser.close();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    ok = await look(page, `http://localhost:${PORT}/`, 'local build');
    await browser.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
