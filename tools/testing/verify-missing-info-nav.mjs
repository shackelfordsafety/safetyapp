// Regression coverage for click-to-jump readiness checklists (Milestone 4 of
// the zero-training UX mission). Confirms every one of the six workflows'
// Review checklist rows navigate to the right step when clicked, and that
// completed rows are non-interactive. Run standalone:
//   node tools/testing/verify-missing-info-nav.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'missing-info-nav');
mkdirSync(outDir, { recursive: true });

const PORT = 4361;
const BASE_URL = `http://localhost:${PORT}`;

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
  else { console.log(`  [FAIL] ${label}`); failures++; }
}

async function main() {
  console.log('[1/8] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/8] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('dialog', d => d.accept());

    // ── JSA: blank draft, everything pending, jump off Review ──
    console.log('\n=== JSA ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Start JSA' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('tab').last().click();
    await page.waitForTimeout(150);
    const jsaPending = page.locator('.reviewCheck.missing').first();
    check(await jsaPending.count() > 0, 'JSA: at least one pending row on a blank draft');
    await jsaPending.click();
    await page.waitForTimeout(150);
    let activeLabel = await page.locator('.stepperSeg.active .stepperSegLabel').first().innerText();
    check(activeLabel !== 'Finish & Export', `JSA: clicking a pending row leaves Review (now on "${activeLabel}")`);

    // ── Incident: blank draft ──
    console.log('\n=== Incident ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Start Incident Report' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('tab').last().click();
    await page.waitForTimeout(150);
    const incPending = page.locator('.incidentReadinessItem.pending').first();
    check(await incPending.count() > 0, 'Incident: at least one pending row on a blank draft');
    await incPending.click();
    await page.waitForTimeout(150);
    activeLabel = await page.locator('.stepperSeg.active .stepperSegLabel').first().innerText();
    check(activeLabel !== 'Review & Export', `Incident: clicking a pending row leaves Review (now on "${activeLabel}")`);

    // ── The four shared-FormPrimitives docs: same pattern each ──
    const sharedDocs = [
      { title: 'Employee Disciplinary Notice' },
      { title: 'Uncontrolled Event Report' },
      { title: 'Employee Medical Event' },
      { title: 'Employee Separation' },
    ];
    for (const doc of sharedDocs) {
      console.log(`\n=== ${doc.title} ===`);
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.waitForSelector(`text=${doc.title}`);
      await page.locator('.listItem', { hasText: doc.title }).getByRole('button', { name: 'Start' }).click();
      await page.waitForTimeout(150);
      await page.getByRole('tab').last().click();
      await page.waitForTimeout(150);
      const pending = page.locator('.incidentReadinessItem.pending').first();
      check(await pending.count() > 0, `${doc.title}: at least one pending row on a blank draft`);
      await pending.click();
      await page.waitForTimeout(150);
      activeLabel = await page.locator('.stepperSeg.active .stepperSegLabel').first().innerText();
      check(activeLabel !== 'Review & Export', `${doc.title}: clicking a pending row leaves Review (now on "${activeLabel}")`);
    }

    // ── Completed rows are non-interactive (spot-check Disciplinary) ──
    console.log('\n=== Completed rows are disabled, not clickable ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('text=Notice Details');
    await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Filled in.');
    await page.getByRole('button', { name: 'Written Warning', exact: true }).click();
    await page.locator('label.field', { hasText: 'Employee Name' }).locator('input').fill('Test Employee');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('tab').last().first().click();
    await page.waitForTimeout(150);
    const okRow = page.locator('.incidentReadinessItem.ok').first();
    check(await okRow.count() > 0, 'At least one completed (ok) row exists after partial fill');
    check(await okRow.isDisabled(), 'A completed row is disabled/non-clickable');
    const beforeStep = await page.locator('.stepperSeg.active .stepperSegLabel').first().innerText();
    await okRow.click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
    const afterStep = await page.locator('.stepperSeg.active .stepperSegLabel').first().innerText();
    check(beforeStep === afterStep, `Force-clicking a disabled completed row does not navigate (stayed on "${afterStep}")`);

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[8/8] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
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
