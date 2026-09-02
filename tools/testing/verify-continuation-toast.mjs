// Review-evidence for the "heads up, this JSA needs a continuation page"
// toast (JsaWorkflow in main.jsx): fires once, the moment content crosses
// into needing a continuation page per the REAL measured plan (not the
// transient character-count heuristic, which can overshoot mid-keystroke
// and get corrected back down a render later -- see the comment on
// continuationBaselineRef in main.jsx), not just the passive preview badge.
//
// Also doubles as the regression check for a real data-loss bug this same
// test caught (2026-09-02): ChipEntryTA's onBlur used to run a fuzzy
// near-duplicate prune on every blur, which fired far more often than the
// old textarea's onBlur ever did (this field blurs after nearly every row
// in the normal task->hazard->control->task workflow) and silently deleted
// rows that legitimately shared most of their wording. The storedCounts
// check at the end confirms all rows survive a real multi-row entry session
// -- see the comment above ChipEntryTA's handleBlur in main.jsx for the fix.
//
//   node tools/testing/verify-continuation-toast.mjs > out.log 2>&1
//
// Strategy: seed 11 rows of realistic task/hazard/control content (11 was
// found by direct measurement to sit right at "Close to full", one row
// short of needing a continuation page), open the draft, confirm no
// continuation toast yet, then add the 12th row via the real chip-entry
// input (type + Enter) -- the exact real interaction a field user performs
// -- and confirm the toast fires right then, its text is correct, and the
// header badge agrees in the same breath.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'continuation-toast');
mkdirSync(outDir, { recursive: true });

const CONTINUATION_TOAST = 'Heads up: this JSA will now print with a continuation page.';
const PORT = 4371;
const BASE_URL = `http://localhost:${PORT}`;

const baseRow = {
  task: 'excavate and shore the north trench line per the engineered drawings, verify spoil pile setback and access',
  hazard: 'trench cave-in, unstable spoil pile setback less than required, workers on foot near the excavator swing',
  control: 'daily competent person inspection, benching per OSHA table, spotter posted anytime the machine swings',
};
function row(i) {
  return { task: `${baseRow.task} (row ${i})`, hazard: `${baseRow.hazard} (row ${i})`, control: `${baseRow.control} (row ${i})` };
}
function buildFixture(n) {
  const rows = Array.from({ length: n }, (_, i) => row(i + 1));
  return {
    id: 'toast-test', status: 'draft', templateName: '', location: 'Test Site', jobSite: 'Test Job', jobNumber: '1',
    date: '2026-09-02', timeIssued: '07:00', timeExpired: '17:00', superintendentForeman: 'Test Super',
    emergencyPhone: '911', client: 'Test Client', nearestMedicalFacility: 'Test Hospital', siteContactPhone: '555-1234',
    musterPoint: 'Gate', assignedMentorSse: 'N/A', acknowledgement: 'Standard acknowledgement text.',
    tailgateTopic: 'Housekeeping', previousDaySafety: 'None reported.', overallWorkTask: 'Test grading work',
    dailyTasks: rows.map(r => r.task).join('\n'), hazardsSummary: rows.map(r => r.hazard).join('\n'), controlsSummary: rows.map(r => r.control).join('\n'),
    taskRows: [], suggestionBundles: [], signatureLineCount: 30, signInMode: 'kiosk', crewSignatures: [], notes: '', lastSavedAt: '',
  };
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
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, JSON.stringify(buildFixture(11)));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('tab', { name: /^Tasks/ }).click();
    await page.waitForTimeout(1500); // measurement rig settle on load
    // Opening a draft shows its own unrelated "Saved draft loaded." toast on
    // the same .toast element -- wait for it to clear before checking.
    await page.waitForTimeout(2600);

    const badgeAt11 = await page.locator('.fitBadge').innerText({ timeout: 1000 }).catch(() => '(not found)');
    const toastAt11 = await page.locator('.toast').innerText({ timeout: 500 }).catch(() => '');
    console.log('At 11 rows -- badge:', badgeAt11, '| toast:', JSON.stringify(toastAt11));
    await page.screenshot({ path: path.join(outDir, '01-eleven-rows-close-to-full.png'), fullPage: true });

    // Add the 12th row via the real chip-entry input.
    const r12 = row(12);
    const taskInput = page.locator('.chipEntryField', { has: page.locator('span', { hasText: 'Tasks for Today' }) }).locator('.chipEntryInput');
    const hazardInput = page.locator('.chipEntryField', { has: page.locator('span', { hasText: 'Hazards in Work Area' }) }).locator('.chipEntryInput');
    const controlInput = page.locator('.chipEntryField', { has: page.locator('span', { hasText: 'Controls and Mitigations' }) }).locator('.chipEntryInput');
    async function dump(label) {
      const c = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('sdc.jsa.draft.v4'));
        return {
          taskLines: (raw.dailyTasks || '').split('\n').length,
          hazardLines: (raw.hazardsSummary || '').split('\n').length,
          controlLines: (raw.controlsSummary || '').split('\n').length,
        };
      });
      console.log(`  [${label}]`, JSON.stringify(c));
    }
    await taskInput.click(); await taskInput.fill(r12.task); await taskInput.press('Enter');
    await page.waitForTimeout(1200); await dump('after task Enter');
    await hazardInput.click(); await hazardInput.fill(r12.hazard); await hazardInput.press('Enter');
    await page.waitForTimeout(1200); await dump('after hazard Enter');
    await controlInput.click(); await controlInput.fill(r12.control); await controlInput.press('Enter');
    let sawToast = '';
    for (let t = 0; t < 8 && !sawToast; t += 1) {
      await page.waitForTimeout(300);
      const txt = await page.locator('.toast').innerText({ timeout: 200 }).catch(() => '');
      if (txt) { sawToast = txt; console.log(`  toast at +${(t + 1) * 300}ms after control Enter:`, JSON.stringify(txt)); }
    }
    await page.waitForTimeout(1000); // let the 900ms autosave debounce flush to localStorage before reading it
    await dump('after control Enter, settled');

    const badgeAt12 = await page.locator('.fitBadge').innerText({ timeout: 1000 }).catch(() => '(not found)');
    console.log('At 12 rows (settled) -- badge:', badgeAt12, '| toast seen at any point:', JSON.stringify(sawToast));
    console.log('Crossing correctly detected:', badgeAt12 === 'CONTINUATION SHEET REQUIRED' && sawToast === CONTINUATION_TOAST);
    await page.screenshot({ path: path.join(outDir, '02-twelve-rows-toast-fires.png'), fullPage: true });

    const storedCounts = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('sdc.jsa.draft.v4'));
      return {
        taskLines: (raw.dailyTasks || '').split('\n').length,
        hazardLines: (raw.hazardsSummary || '').split('\n').length,
        controlLines: (raw.controlsSummary || '').split('\n').length,
        lastTask: (raw.dailyTasks || '').split('\n').pop(),
      };
    });
    console.log('Actual stored content after adding row 12:', JSON.stringify(storedCounts, null, 2));

    const noDataLoss = storedCounts.taskLines === 12 && storedCounts.hazardLines === 12 && storedCounts.controlLines === 12;
    const toastCorrect = sawToast === CONTINUATION_TOAST;
    const badgeCorrect = badgeAt12 === 'CONTINUATION SHEET REQUIRED';
    console.log('\n=== RESULT ===');
    console.log('No rows lost during entry (12/12/12):', noDataLoss);
    console.log('Continuation toast fired with correct text:', toastCorrect);
    console.log('Header badge agrees:', badgeCorrect);
    if (errors.length) console.log('!! page errors:', JSON.stringify(errors, null, 2));
    if (!noDataLoss || !toastCorrect || !badgeCorrect || errors.length) process.exitCode = 1;
    await browser.close();
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error('crashed:', err); process.exit(1); });
