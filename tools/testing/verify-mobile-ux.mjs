// TEMPORARY verification script (2026-08-10 mobile UX rework).
//
// Not part of the application build/bundle -- lives entirely under
// tools/testing/ and is invoked manually with
// `node tools/testing/verify-mobile-ux.mjs`. Requires `npm run build` to
// have already produced dist/, and the `playwright` dev dependency
// installed. Makes no changes to any application source file; writes only
// screenshots under tools/testing/output/mobile-ux/.
//
// What it does:
//   1. Starts `vite preview` (serves the production build in dist/).
//   2. Seeds a JSA draft + an Incident draft into localStorage so the
//      "Continue Current Work" cards render on Home.
//   3. For each required viewport (390, 430, 820, 1280, plus a tall
//      iPhone-like viewport), loads Home and:
//      - screenshots the full page
//      - asserts no horizontal overflow (scrollWidth <= clientWidth)
//      - asserts sidebar vs. bottom-nav visibility matches the breakpoint
//        (sidebar hidden + bottom nav visible <=680px, sidebar visible +
//        no bottom nav >680px)
//      - at phone widths, clicks each bottom-nav destination and confirms
//        the active state + destination content renders, then confirms the
//        bottom nav disappears once a document flow (JSA start) is open

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'mobile-ux');
mkdirSync(outDir, { recursive: true });

const PORT = 4341;
const BASE_URL = `http://localhost:${PORT}`;

const jsaDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');
JSON.parse(jsaDraft);
const incidentDraft = readFileSync(path.join(__dirname, 'fixtures', 'incident-user-draft-fixture.json'), 'utf8');
JSON.parse(incidentDraft);

const VIEWPORTS = [
  { name: '390-phone', width: 390, height: 844 },
  { name: '430-phone', width: 430, height: 932 },
  { name: '375-tall-iphone', width: 375, height: 812 },
  { name: '820-tablet', width: 820, height: 1180 },
  { name: '1280-desktop', width: 1280, height: 900 },
];

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Server at ${url} did not become ready in time`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label}`);
    failures++;
  }
}

async function main() {
  console.log('[1/4] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/4] Preview server ready at', BASE_URL);

    const browser = await chromium.launch();

    for (const vp of VIEWPORTS) {
      console.log(`\n[3/4] Viewport: ${vp.name} (${vp.width}x${vp.height})`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.width <= 820,
        isMobile: vp.width <= 430,
      });
      await context.addInitScript(([draftJson, incidentJson]) => {
        window.localStorage.setItem('sdc.jsa.draft.v4', draftJson);
        window.localStorage.setItem('sdc.incident.draft.v1', incidentJson);
      }, [jsaDraft, incidentDraft]);

      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(String(err)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('.homeLayout', { timeout: 10000 });
      await page.waitForTimeout(200);

      const isPhone = vp.width <= 680;

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `No horizontal overflow (scrollWidth - clientWidth = ${overflow})`);

      const sidebarVisible = await page.evaluate(() => {
        const el = document.querySelector('.sidebar');
        return !!el && getComputedStyle(el).display !== 'none' && el.offsetWidth > 0;
      });
      const bottomNavVisible = await page.evaluate(() => {
        const el = document.querySelector('.mobileBottomNav');
        return !!el && getComputedStyle(el).display !== 'none' && el.offsetHeight > 0;
      });

      if (isPhone) {
        check(!sidebarVisible, 'Sidebar hidden at phone width');
        check(bottomNavVisible, 'Bottom nav visible at phone width');
      } else {
        check(sidebarVisible, 'Sidebar visible at tablet/desktop width');
        check(!bottomNavVisible, 'Bottom nav absent at tablet/desktop width');
      }

      if (bottomNavVisible) {
        const navBox = await page.evaluate(() => {
          const el = document.querySelector('.mobileBottomNav');
          const r = el.getBoundingClientRect();
          return { bottom: r.bottom, top: r.top, viewportH: window.innerHeight };
        });
        check(Math.abs(navBox.bottom - navBox.viewportH) <= 1, 'Bottom nav is flush with viewport bottom');

        // Confirm bottom nav doesn't cover the last piece of Home content:
        // scroll all the way down and check the last document-library row
        // sits above the nav bar top, not underneath it.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(100);
        const lastRowBottom = await page.evaluate(() => {
          const rows = document.querySelectorAll('.libraryRow');
          const last = rows[rows.length - 1];
          return last ? last.getBoundingClientRect().bottom : null;
        });
        if (lastRowBottom != null) {
          check(lastRowBottom <= navBox.top + 2, `Last Document Library row (bottom=${lastRowBottom.toFixed(0)}) clears bottom nav (top=${navBox.top.toFixed(0)}) after scrolling to page end`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      await page.screenshot({ path: path.join(outDir, `${vp.name}-home.png`), fullPage: true });

      if (bottomNavVisible) {
        // Exercise each destination + active state.
        const destinations = [
          { label: 'Documents', selector: '.mobileNavItem:has-text("Documents")' },
          { label: 'Today', selector: '.mobileNavItem:has-text("Today")' },
          { label: 'Templates', selector: '.mobileNavItem:has-text("Templates")' },
          { label: 'Settings', selector: '.mobileNavItem:has-text("Settings")' },
        ];
        for (const dest of destinations) {
          await page.click(dest.selector);
          await page.waitForTimeout(150);
          const isActive = await page.locator(dest.selector).evaluate(el => el.classList.contains('active'));
          check(isActive, `${dest.label}: bottom nav shows active state after tap`);
          const contentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          check(contentOverflow <= 1, `${dest.label}: no horizontal overflow on destination screen`);
        }
        await page.screenshot({ path: path.join(outDir, `${vp.name}-settings.png`), fullPage: true });

        // Back to Home, then open a document flow (JSA start) and confirm
        // the bottom nav disappears (workflow owns the bottom of the screen).
        await page.click('.mobileNavItem:has-text("Home")');
        await page.waitForTimeout(150);
        await page.click('.startDocTile >> text=Start JSA');
        await page.waitForTimeout(300);
        const navGoneInFlow = await page.evaluate(() => {
          const el = document.querySelector('.mobileBottomNav');
          return !el || getComputedStyle(el).display === 'none';
        });
        check(navGoneInFlow, 'Bottom nav hidden once a document flow (JSA builder) is open');
        await page.screenshot({ path: path.join(outDir, `${vp.name}-jsa-flow.png`), fullPage: false });
      } else {
        await page.click('.sidebarNavItem:has-text("Documents")');
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(outDir, `${vp.name}-documents.png`), fullPage: true });
      }

      check(pageErrors.length === 0, `No uncaught page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[4/4] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) {
    console.log('--- preview server output (tail) ---');
    console.log(serverOutput.slice(-2000));
    process.exit(1);
  }
}

main().then(() => {
  // Explicit success exit: the spawned 'vite preview' grandchild keeps Node's
  // event loop alive on Windows even after server.kill(), so a PASSING run
  // would otherwise hang until the caller's timeout instead of finishing.
  process.exit(0);
}).catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
