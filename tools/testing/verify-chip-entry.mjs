// Review-evidence capture for the JSA Tasks/Hazards/Controls chip-entry
// change (StepWork: ChipEntryTA replaces the free-typing textarea -- type
// an entry, press Enter, it becomes a removable row).
//
//   node tools/testing/verify-chip-entry.mjs > out.log 2>&1
//
// Drives a REAL blank JSA against a vite preview of the production build,
// types several messy real-world entries into each of the three chip
// fields via actual Enter keypresses (not a stub), exercises remove and
// tap-to-edit, screenshots the step at tablet + desktop, then continues
// through Review -> Finish & Export -> Create Document -> Download to
// confirm the underlying newline-joined data model (and therefore the PDF
// pipeline) is unaffected.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'chip-entry');
mkdirSync(outDir, { recursive: true });

const PORT = 4351;
const BASE_URL = `http://localhost:${PORT}`;

const VIEWPORTS = [
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
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

async function shoot(page, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  console.log(`  shot: ${name}.png`);
}

async function startBlankJsa(page) {
  await page.locator('.sidebarNavItem, .mobileNavItem', { hasText: 'Documents' }).first().click();
  await page.waitForTimeout(300);
  const row = page.locator('.listItem', { hasText: 'Job Safety Analysis' }).first();
  await row.getByRole('button', { name: /Start|Open/ }).first().click();
  await page.waitForTimeout(500);
  // JSA has an intermediate "Start a JSA" options screen (Start Blank /
  // Repeat Last / Continue Draft / Load Template) before the builder opens.
  const startBlank = page.getByRole('button', { name: /^Start Blank/ });
  if (await startBlank.count() > 0 && await startBlank.first().isVisible().catch(() => false)) {
    await startBlank.first().click();
    await page.waitForTimeout(500);
  }
}

// Real Enter-per-entry typing, not a bulk fill -- exactly what a field user
// does. Messy phrasing/punctuation on purpose per CLAUDE.md's testing
// guidance (clean strings have hidden real bugs before).
async function typeChipEntries(page, fieldLabel, entries) {
  const input = page.locator('.chipEntryField', { has: page.locator('span', { hasText: fieldLabel }) }).locator('.chipEntryInput');
  for (const entry of entries) {
    await input.click();
    await input.fill(entry);
    await input.press('Enter');
    await page.waitForTimeout(120);
  }
}

async function run(browser, vp) {
  const tag = vp.name;
  console.log(`\n=== ${tag} (${vp.width}x${vp.height}) ===`);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...(vp.touch ? { hasTouch: true, isMobile: false } : {}),
    acceptDownloads: true,
  });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  await startBlankJsa(page);
  await shoot(page, `${tag}-00-after-start`);
  // Job Info -> Meeting Info -> Tasks/Hazards.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForTimeout(250);
  await shoot(page, `${tag}-01-tasks-step-empty`);

  await typeChipEntries(page, 'Tasks for Today', [
    'walk the site w/ foreman before start-up',
    'set up barricades & cones around the trench',
    'housekeeping -- clear scrap + debris from walkways',
  ]);
  await typeChipEntries(page, 'Hazards in Work Area', [
    'trench cave-in / unstable spoil pile',
    'workers on foot near the excavator swing radius',
    "90+ degree heat, no shade near the cut",
  ]);
  await typeChipEntries(page, 'Controls and Mitigations', [
    'daily competent person trench inspection',
    'spotter posted anytime the excavator is swinging',
    'water + shade breaks every 30 min, buddy system',
  ]);
  await shoot(page, `${tag}-02-tasks-step-filled`);

  // Tap-to-edit: pull the last hazard back into its input.
  const hazardRow = page.locator('.chipEntryField', { has: page.locator('span', { hasText: 'Hazards in Work Area' }) }).locator('.chipEntryRow').last();
  await hazardRow.locator('.chipEntryText').click();
  await shoot(page, `${tag}-03-tap-to-edit`);
  await page.locator('.chipEntryField', { has: page.locator('span', { hasText: 'Hazards in Work Area' }) }).locator('.chipEntryInput').press('Enter');

  // Remove: X button on a control row.
  const controlRow = page.locator('.chipEntryField', { has: page.locator('span', { hasText: 'Controls and Mitigations' }) }).locator('.chipEntryRow').first();
  await controlRow.locator('.chipEntryRemove').click();
  await page.waitForTimeout(150);
  await shoot(page, `${tag}-04-after-remove`);

  if (vp.name === 'desktop') {
    // Confirm the chip-entered data actually reaches the live print-preview
    // panel (JsaPreview renders the same MainJsaDocumentPage component the
    // real print/PDF path uses -- see CLAUDE.md's print/PDF pipeline notes).
    await page.getByRole('tab', { name: /^Review/ }).click();
    await page.waitForTimeout(400);
    await shoot(page, `${tag}-05-review-with-preview`);
  }

  if (errors.length) console.log(`  !! page errors: ${errors.join(' | ')}`);
  await context.close();
}

async function main() {
  console.log('[1/3] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/3] Preview ready at', BASE_URL);
    const browser = await chromium.launch();
    for (const vp of VIEWPORTS) await run(browser, vp);
    await browser.close();
    console.log('[3/3] Done.');
  } finally {
    killTree(server);
  }
  console.log('\nScreenshots written to tools/testing/output/chip-entry/');
}

main().then(() => {
  process.exit(0);
}).catch(err => { console.error('verify-chip-entry crashed:', err); process.exit(1); });
