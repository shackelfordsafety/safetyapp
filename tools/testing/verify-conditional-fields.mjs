// Regression coverage for progressive disclosure (mission Part 3). These
// conditional flows were already implemented before this mission (confirmed
// by code reading, not assumed) -- this suite guards that toggling the
// controlling answer back and forth never silently discards previously
// entered text in the now-hidden field, and that a draft reload restores
// the same visible state. Run standalone:
//   node tools/testing/verify-conditional-fields.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'conditional-fields');
mkdirSync(outDir, { recursive: true });

const PORT = 4362;
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
  console.log('[1/7] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/7] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('dialog', d => d.accept());

    // ── 1. Incident: injury Yes/No/Yes preserves text + survives reload ──
    console.log('\n=== 1. Incident injury toggle ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Start Incident Report' }).click();
    await page.getByRole('tab', { name: /Injury/ }).click();
    await page.waitForTimeout(150);
    check(await page.locator('label.field', { hasText: 'Injured party name' }).count() === 0, 'Injury detail fields hidden before Yes is selected');
    await page.locator('.field', { hasText: 'Was anyone injured?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    const injuredNameInput = page.locator('label.field', { hasText: /^Name, title, years/ }).locator('input');
    check(await injuredNameInput.count() === 1, 'Injured party fields appear once Yes is selected');
    await injuredNameInput.fill('Jordan Diaz');
    await page.locator('.field', { hasText: 'Was anyone injured?' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.waitForTimeout(150);
    check(await page.locator('label.field', { hasText: /^Name, title, years/ }).count() === 0, 'Injury detail fields hide again once switched back to No');
    await page.locator('.field', { hasText: 'Was anyone injured?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    check(await injuredNameInput.inputValue() === 'Jordan Diaz', 'Previously entered injured-party name survives a No -> Yes round trip');

    await page.waitForTimeout(1200); // past autosave debounce
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Continue Incident Report' }).click().catch(async () => {
      await page.getByRole('button', { name: 'Today', exact: false }).first().click();
      await page.locator('.listItem').first().getByRole('button', { name: 'Open' }).click();
    });
    await page.waitForTimeout(200);
    await page.getByRole('tab', { name: /Injury/ }).click();
    await page.waitForTimeout(150);
    check(await page.locator('.field', { hasText: 'Was anyone injured?' }).getByRole('button', { name: 'Yes', exact: true }).getAttribute('aria-pressed') === 'true', 'Reload: injury toggle still shows Yes');
    check(await page.locator('label.field', { hasText: /^Name, title, years/ }).locator('input').inputValue() === 'Jordan Diaz', 'Reload: injured party name restored');

    // ── 2. Incident: property damage Yes/No/Yes preserves text ──
    console.log('\n=== 2. Incident property damage toggle ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.evaluate(() => localStorage.removeItem('sdc.incident.draft.v1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Start Incident Report' }).click();
    await page.getByRole('tab', { name: /Property Damage/ }).click();
    await page.waitForTimeout(150);
    check(await page.locator('label.field', { hasText: 'List property/material damaged' }).count() === 0, 'Property detail fields hidden before Yes');
    await page.locator('.field', { hasText: 'Was there property damage?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    const damagedInput = page.locator('label.field', { hasText: 'List property/material damaged' }).locator('input');
    await damagedInput.fill('Chain-link fence section');
    await page.locator('.field', { hasText: 'Was there property damage?' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.waitForTimeout(150);
    await page.locator('.field', { hasText: 'Was there property damage?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    check(await damagedInput.inputValue() === 'Chain-link fence section', 'Property damage text survives a No -> Yes round trip');

    // ── 3. Medical Event: work event Yes/No/Yes preserves text ──
    console.log('\n=== 3. Medical Event work-event toggle ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Employee Medical Event' }).getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(150);
    check(await page.getByRole('textbox', { name: 'Describe the work event / exposure reported' }).count() === 0, 'Work-event description hidden before Yes');
    await page.locator('.field', { hasText: 'Specific Work Event or Exposure Reported?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    const workEventTa = page.getByRole('textbox', { name: 'Describe the work event / exposure reported' });
    check(await workEventTa.count() === 1, 'Work-event description appears once Yes is selected');
    await workEventTa.fill('Employee reported a slip near the mixer.');
    check(await page.locator('.pdfStaleWarning').count() === 1, 'Cross-report advisory notice shown once a work event is reported');
    await page.locator('.field', { hasText: 'Specific Work Event or Exposure Reported?' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.waitForTimeout(150);
    check(await page.getByRole('textbox', { name: 'Describe the work event / exposure reported' }).count() === 0, 'Work-event description hides again once switched back to No');
    await page.locator('.field', { hasText: 'Specific Work Event or Exposure Reported?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    check(await workEventTa.inputValue() === 'Employee reported a slip near the mixer.', 'Work-event description survives a No -> Yes round trip');

    // ── 4. Separation: rehire eligibility No/Yes/No preserves reason ──
    console.log('\n=== 4. Separation rehire-eligibility toggle ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Employee Separation' }).getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('tab', { name: /Closeout/ }).click();
    await page.waitForTimeout(150);
    check(await page.locator('label.field', { hasText: 'Reason not eligible for rehire' }).count() === 0, 'Rehire-reason field hidden before No is selected');
    await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.waitForTimeout(150);
    const rehireReasonInput = page.locator('label.field', { hasText: 'Reason not eligible for rehire' }).locator('input');
    check(await rehireReasonInput.count() === 1, 'Rehire-reason field appears once No is selected');
    await rehireReasonInput.fill('Attendance policy violations.');
    await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForTimeout(150);
    check(await page.locator('label.field', { hasText: 'Reason not eligible for rehire' }).count() === 0, 'Rehire-reason field hides once switched to Yes');
    await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.waitForTimeout(150);
    check(await rehireReasonInput.inputValue() === 'Attendance policy violations.', 'Rehire reason survives a Yes -> No round trip');

    // ── 5. Separation: Involuntary reveals the warning-notices block ──
    console.log('\n=== 5. Separation involuntary toggle ===');
    check(await page.locator('.field', { hasText: 'Were warning notices given' }).count() === 0, 'Warning-notices field hidden while Separation Type is unset/voluntary');
    await page.getByRole('tab', { name: /Separation Details/ }).click();
    await page.waitForTimeout(150);
    await page.locator('.field', { hasText: 'Separation Type' }).getByRole('button', { name: 'Involuntary', exact: true }).click();
    await page.getByRole('tab', { name: /Closeout/ }).click();
    await page.waitForTimeout(150);
    check(await page.locator('.field', { hasText: 'Were warning notices given' }).count() === 1, 'Warning-notices field appears once Involuntary is selected');

    // ── 6. Uncontrolled Event: "Other" classification reveals its specify field ──
    console.log('\n=== 6. Uncontrolled Event "Other" classification toggle ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.homeLayout');
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Uncontrolled Event Report' }).getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(150);
    const classificationGroup = page.locator('.field', { hasText: 'Event Classification (check all that apply)' });
    check(await page.locator('label.field', { hasText: 'Other classification' }).count() === 0, '"Other classification" specify field hidden before Other is checked');
    await classificationGroup.getByRole('button', { name: 'Other', exact: true }).click();
    await page.waitForTimeout(150);
    const otherClassInput = page.locator('label.field', { hasText: 'Other classification' }).locator('input');
    check(await otherClassInput.count() === 1, '"Other classification" specify field appears once Other is checked');
    await otherClassInput.fill('Dust storm.');
    await classificationGroup.getByRole('button', { name: 'Other', exact: true }).click(); // uncheck
    await page.waitForTimeout(150);
    check(await page.locator('label.field', { hasText: 'Other classification' }).count() === 0, '"Other classification" field hides again once unchecked');
    await classificationGroup.getByRole('button', { name: 'Other', exact: true }).click(); // recheck
    await page.waitForTimeout(150);
    check(await otherClassInput.inputValue() === 'Dust storm.', '"Other classification" text survives an uncheck -> recheck round trip');

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[7/7] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
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
