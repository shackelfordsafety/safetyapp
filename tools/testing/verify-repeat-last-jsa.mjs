// Verifies the new "Repeat Last JSA" start option (2026-08-29): carries
// forward job info/tasks/hazards/controls from the last saved JSA, resets
// day-specific fields (date, tailgate topic, crew signatures), same as
// loading a real template but sourced from the saved draft instead.
//   node tools/testing/verify-repeat-last-jsa.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const PORT = 4329;
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
  else { console.log(`  [FAIL] ${label}`); failures += 1; }
}

async function main() {
  console.log('Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'jsa-stress-messy-continuation.json'), 'utf8'));
    // Simulate yesterday's already-completed JSA sitting as the current
    // saved draft -- exactly the real-world state this feature targets.
    fixture.status = 'completed';
    fixture.crewSignatures = [{ dataUrl: 'data:image/png;base64,fake', signedAt: new Date().toISOString() }];
    fixture.tailgateTopic = 'Fall protection refresher';
    fixture.date = '2026-08-28';

    const page = await context.newPage();
    const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));
    await context.addInitScript(json => window.localStorage.setItem('sdc.jsa.draft.v4', json), JSON.stringify(fixture));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Job Safety Analysis' }).getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('text=Start a JSA');

    const repeatBtn = page.getByRole('button', { name: /Repeat Last JSA/ });
    check(await repeatBtn.isEnabled(), 'Repeat Last JSA is enabled when a saved draft exists');
    await repeatBtn.click();
    await page.waitForSelector('text=Job Information');

    const jobSite = await page.getByRole('textbox', { name: 'Job Site', exact: true }).inputValue();
    check(jobSite === fixture.jobSite, `Job site carried forward (got "${jobSite}")`);
    const dateVal = await page.getByRole('textbox', { name: 'Date', exact: true }).inputValue().catch(() => null)
      ?? await page.locator('input[type="date"]').first().inputValue();
    const today = new Date().toISOString().slice(0, 10);
    check(dateVal === today, `Date reset to today (got "${dateVal}", expected "${today}")`);

    // Work step should still have the fixture's task rows.
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForSelector('text=Meeting Info').catch(() => {});
    const tailgateVal = await page.locator('textarea, input').filter({ hasText: '' }).first().inputValue().catch(() => '');
    // Looser check: tailgate topic field specifically.
    const tailgateField = page.getByRole('textbox', { name: /Tailgate Topic/i });
    if (await tailgateField.count()) {
      const v = await tailgateField.inputValue();
      check(v !== fixture.tailgateTopic, `Tailgate topic reset, not carried forward (got "${v}")`);
    }

    const raw = await page.evaluate(key => window.localStorage.getItem(key), 'sdc.jsa.draft.v4');
    // Draft won't be persisted yet (autosave debounce) unless we wait -- give it a moment.
    await page.waitForTimeout(1200);
    const raw2 = await page.evaluate(key => window.localStorage.getItem(key), 'sdc.jsa.draft.v4');
    const persisted = JSON.parse(raw2 || 'null');
    check(Boolean(persisted), 'New JSA autosaved after Repeat Last JSA');
    check(persisted?.status === 'draft', `New JSA status reset to 'draft' (got "${persisted?.status}")`);
    check((persisted?.crewSignatures || []).length === 0, 'Crew signatures cleared on the new JSA');
    check(Array.isArray(persisted?.taskRows) && persisted.taskRows.length === fixture.taskRows.length, `Task rows carried forward (${persisted?.taskRows?.length} vs fixture's ${fixture.taskRows.length})`);

    check(pageErrors.length === 0, `No page errors (${pageErrors.length})${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    await context.close();
    await browser.close();
  } finally {
    killTree(server);
  }
  console.log(`\nDone. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
