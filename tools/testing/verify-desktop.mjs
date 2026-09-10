// Is this thing actually usable on a desktop?
//
// The app was built for a 1180px tablet and gets used on iPads and
// phones. The office -- HR, the PM, the owners -- sit at real monitors,
// and the redesign notes say full desktop parity was never finished. So
// this looks instead of assuming.
//
// Checks the two things that actually make a desktop layout feel broken:
// content that stops growing and strands the right-hand third of a wide
// monitor, and anything that pushes the page sideways.
//
// Usage: node tools/testing/verify-desktop.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'desktop');
mkdirSync(outDir, { recursive: true });

const PORT = 4351;
const BASE = `http://localhost:${PORT}/`;
const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-medical-address.json'), 'utf8');

const SIZES = [
  { name: '1280-laptop', width: 1280, height: 800 },
  { name: '1440-desktop', width: 1440, height: 900 },
  { name: '1920-monitor', width: 1920, height: 1080 },
  { name: '2560-wide', width: 2560, height: 1440 },
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

async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main.page');
    const content = main?.firstElementChild;
    return {
      viewport: window.innerWidth,
      // Sideways scroll is an outright bug, not a taste question.
      overflowsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
      contentWidth: content ? Math.round(content.getBoundingClientRect().width) : null,
      sidebarWidth: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().width || 0),
      // Are the sidebar labels showing, or is it still the icon rail?
      sidebarLabelled: Boolean(document.querySelector('.sidebarNavLabel')?.getBoundingClientRect().width),
    };
  });
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 20000);
    const browser = await chromium.launch();
    let problems = 0;

    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      await context.addInitScript((json) => {
        window.localStorage.setItem('sdc.jsa.draft.v4', json);
      }, draftJson);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));

      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      const home = await measure(page);
      await page.screenshot({ path: path.join(outDir, `${size.name}-home.png`) });

      // The screen an office user would actually spend time in.
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.waitForTimeout(800);
      const builder = await measure(page);
      await page.screenshot({ path: path.join(outDir, `${size.name}-jsa.png`) });

      const usedShare = builder.contentWidth && Math.round((builder.contentWidth / size.width) * 100);
      console.log(`\n[${size.name}]  ${size.width}px wide`);
      console.log(`   sidebar:            ${home.sidebarWidth}px ${home.sidebarLabelled ? '(labelled)' : '(icon rail)'}`);
      console.log(`   builder content:    ${builder.contentWidth}px — ${usedShare}% of the screen`);
      console.log(`   scrolls sideways:   home ${home.overflowsSideways} / builder ${builder.overflowsSideways}`);
      if (errors.length) console.log(`   PAGE ERRORS: ${errors.join(', ')}`);

      if (home.overflowsSideways || builder.overflowsSideways || errors.length) problems += 1;

      await context.close();
    }

    console.log(problems === 0
      ? '\nNo outright breakage at any desktop width.'
      : `\n${problems} width(s) with real breakage.`);
    await browser.close();
    process.exitCode = problems === 0 ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
