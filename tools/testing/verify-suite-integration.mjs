// Regression coverage for Milestone 6 of the Superintendent Document Suite
// mission: Home/Documents/Drafts integration across all six document types,
// plus a mobile viewport pass. Standalone execution (no pipe to tail).
//   node tools/testing/verify-suite-integration.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'suite-integration');
mkdirSync(outDir, { recursive: true });

const PORT = 4329;
const BASE_URL = `http://localhost:${PORT}`;

function loadFixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

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
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label}`); failures += 1; }
}

const ALL_SIX_TITLES = [
  'Job Safety Analysis', 'Incident Report', 'Uncontrolled Event Report',
  'Employee Medical Event', 'Employee Disciplinary Notice', 'Employee Separation',
];

// "Unplanned Event" was removed from PLANNED_DOCUMENT_TYPES (main.jsx) once
// the live Uncontrolled Event Report shipped and took over that functional
// category -- these five are what should remain.
const PLANNED_TITLES = ['BBS Observation', 'Sign-In Sheet', 'Toolbox Talk', 'SOP', 'Inspection'];

async function main() {
  console.log('[1/4] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/4] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ── 1. Documents tab lists all six available documents, grouped ──
    console.log('\n=== 1. Documents tab (all six, categorized) ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.waitForSelector('text=Field Safety');
      for (const title of ALL_SIX_TITLES) {
        const count = await page.locator('.listItem', { hasText: title }).count();
        check(count === 1, `"${title}" appears exactly once in Documents`);
      }
      const fieldSafetyGroup = await page.locator('text=Field Safety').count();
      const employeeActionGroup = await page.locator('text=Employee Action').count();
      check(fieldSafetyGroup >= 1, 'Field Safety category heading present');
      check(employeeActionGroup >= 1, 'Employee Action category heading present');

      // Planned Document Library: exactly the five intended future types,
      // "Unplanned Event" gone now that Uncontrolled Event Report is live.
      const plannedRows = page.locator('.libraryRow');
      check(await plannedRows.count() === PLANNED_TITLES.length, `Exactly ${PLANNED_TITLES.length} planned document rows shown, got ${await plannedRows.count()}`);
      check(await page.locator('.libraryRow', { hasText: 'Unplanned Event' }).count() === 0, '"Unplanned Event" is absent from the planned list');
      for (const title of PLANNED_TITLES) {
        check(await page.locator('.libraryRow', { hasText: title }).count() === 1, `Planned document "${title}" present exactly once`);
      }
      // Uncontrolled Event Report is live and startable, not just listed.
      const uncontrolledRow = page.locator('.listItem', { hasText: 'Uncontrolled Event Report' });
      check(await uncontrolledRow.locator('button', { hasText: 'Start' }).count() === 1, 'Live Uncontrolled Event Report has a working Start button');

      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);
      await context.close();
    }

    // ── 2. Home: every available document type is equally reachable ──
    /* Home used to give JSA and Incident hero cards and demote the other four
       to rows under "More Documents", and this section asserted exactly that
       split. The split was build order rather than field priority, so what is
       worth protecting now is the opposite: one tile per available document
       type, all the same, with nothing buried. */
    console.log('\n=== 2. Home — every document type has a start tile ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('text=Start a Document');
      for (const title of ['JSA', 'Incident Report', 'Uncontrolled Event', 'Medical Event', 'Disciplinary Notice', 'Employee Separation']) {
        const tile = page.locator('.startDocTile').filter({ has: page.locator('h2', { hasText: title }) });
        check(await tile.count() === 1, `Home has one start tile for "${title}"`);
        check(await tile.getByRole('button', { name: `Start ${title}` }).count() === 1, `"${title}" tile has its own Start button`);
      }
      check(await page.locator('.startDocTile').count() === 6, 'Home shows exactly the six available document types');
      // Clicking a tile reaches that document's builder.
      await page.getByRole('button', { name: 'Start Employee Separation' }).click();
      await page.waitForSelector('text=Separation Details');
      check(true, 'Home start tile opens the Employee Separation builder');
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);
      await page.screenshot({ path: path.join(outDir, 'home-then-separation-1280.png'), fullPage: true });
      await context.close();
    }

    // ── 3. Drafts: shows entries for whichever document types have a saved draft ──
    console.log('\n=== 3. Drafts — multi-document visibility, no cross-collision ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(json => window.localStorage.setItem('sdc.discipline.draft.v1', json), loadFixture('disciplinary-normal.json'));
      await context.addInitScript(json => window.localStorage.setItem('sdc.separation.draft.v1', json), loadFixture('separation-discharge.json'));
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'My Work' }).first().click();
      await page.waitForSelector('text=Saved Drafts');
      // Both fixtures use "Marcus Doyle" as the employee name, so rows are
      // distinguished by their own meta line text (Warning level vs.
      // Discharge reason) rather than the shared title.
      const warningLevelMeta = await page.locator('.listItem', { hasText: 'Warning level' }).count();
      const separationReasonMeta = await page.locator('.listItem', { hasText: 'Discharge' }).count();
      check(warningLevelMeta === 1, 'Exactly one Disciplinary draft row (no duplication)');
      check(separationReasonMeta === 1, 'Exactly one Separation draft row (no duplication)');
      // Untouched document types show no row at all.
      const jsaRow = await page.locator('.listItem', { hasText: 'JSA Draft' }).count();
      check(jsaRow === 0, 'No JSA draft row when no JSA draft exists (no fabricated entries)');
      check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)`);
      await page.evaluate(() => window.localStorage.clear());
      await context.close();
    }

    // ── 4. Mobile / tablet / desktop viewport pass across Home, Documents, Drafts ──
    console.log('\n=== 4. Viewport pass (375/390/430/820/1280) ===');
    const viewports = [
      { name: '375', width: 375, height: 812 },
      { name: '390', width: 390, height: 844 },
      { name: '430', width: 430, height: 932 },
      { name: '820', width: 820, height: 1180 },
      { name: '1280', width: 1280, height: 900 },
    ];
    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.width < 700, hasTouch: vp.width < 700 });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `[${vp.name}px] Home: no horizontal overflow (diff=${overflow})`);
      await page.screenshot({ path: path.join(outDir, `${vp.name}-home.png`), fullPage: true });

      const navSelector = vp.width < 700 ? '.mobileNavItem' : '.sidebarNavItem';
      await page.locator(navSelector, { hasText: 'Documents' }).first().click();
      await page.waitForTimeout(200);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `[${vp.name}px] Documents: no horizontal overflow (diff=${overflow})`);
      await page.screenshot({ path: path.join(outDir, `${vp.name}-documents.png`), fullPage: true });

      await page.locator(navSelector, { hasText: 'My Work' }).first().click();
      await page.waitForTimeout(200);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 1, `[${vp.name}px] Drafts: no horizontal overflow (diff=${overflow})`);

      check(pageErrors.length === 0, `[${vp.name}px] No page errors (${pageErrors.length} found)`);
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
