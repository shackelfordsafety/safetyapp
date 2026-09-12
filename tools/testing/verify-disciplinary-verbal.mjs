// Focused check for the "Verbal Warning" workflow change: a verbal warning is
// a coaching conversation, not a signed notice -- the employee never signs,
// only the manager does. Same pattern as verify-disciplinary.mjs, scoped to
// just this scenario. Run standalone (no pipe to tail):
//   node tools/testing/verify-disciplinary-verbal.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { checkPdfContract } from './lib/pdfContract.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'disciplinary');
mkdirSync(outDir, { recursive: true });

const PORT = 4326;
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_KEY = 'sdc.discipline.draft.v1';

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
  console.log('[1/3] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/3] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    console.log('\n=== Verbal Warning: no employee signature required ===');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = []; const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('text=Notice Details');

    await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Randy Speer');
    await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('J. Alvarez');
    await page.getByRole('textbox', { name: 'Position', exact: true }).fill('Flagger');
    await page.getByRole('button', { name: 'Verbal Warning', exact: true }).click();
    await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Spoke out disruptively during the morning safety meeting after another employee was corrected about turning in a radio.');

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForSelector('text=Corrective Action');
    await page.getByRole('textbox', { name: 'What must the employee do to correct this?', exact: true }).fill('Raise concerns privately with a supervisor instead of talking back during group meetings.');

    // No Employee Statement section either -- it's a coaching conversation,
    // not a formal statement being taken down.
    check(await page.locator('text=Employee Statement').count() === 0, 'No "Employee Statement" section rendered for a Verbal Warning');

    // The core behavior under test: no employee signature pad/toggle at all
    // for a Verbal Warning, just the explanatory note and the manager pad.
    /* Signatures are their own step now -- standing on Corrective Action
       and looking for a signature pad finds nothing, which is how this
       script started reporting a missing note that was never missing. */
    await page.getByRole('tab').last().click().catch(() => {});
    await page.getByRole('tab', { name: /Signature/i }).first().click().catch(() => {});
    await page.waitForTimeout(500);

    const employeeSigPad = page.locator('.signaturePad', { hasText: 'Employee Signature' });
    check(await employeeSigPad.count() === 0, 'No Employee Signature pad rendered for a Verbal Warning');
    const refusedToggle = page.locator('label.field', { hasText: 'Employee refused / unavailable to sign' });
    check(await refusedToggle.count() === 0, 'No "refused to sign" toggle rendered for a Verbal Warning');
    check(await page.locator('text=coaching conversation').count() > 0, 'Explanatory coaching-conversation note is shown');

    await page.locator('.signaturePad', { hasText: 'Manager Signature' }).getByRole('button', { name: 'Add signature' }).click();
    const canvas = page.locator('canvas.signatureCanvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 8 });
    await page.mouse.up();
    await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();

    await page.getByRole('tab').last().first().click();
    await page.waitForSelector('text=Readiness');
    const pendingItems = await page.locator('.incidentReadinessItem.pending').count();
    check(pendingItems === 0, `Readiness checklist satisfied with only a manager signature (${pendingItems} pending item(s))`);
    const empSigCheckText = await page.locator('.incidentReadinessItem', { hasText: 'Employee signature' }).count();
    check(empSigCheckText === 0, 'Readiness checklist has no "Employee signature" line item at all for Verbal');

    const finishBtn = page.getByRole('button', { name: 'Mark Complete', exact: true });
    check(await finishBtn.isEnabled(), 'Mark Complete is enabled');
    await finishBtn.click();
    await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
    await page.waitForTimeout(300);

    await page.locator('.reviewPrimaryAction button').first().click();
    await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
    const { pdf } = await downloadGeneratedPdf(page, path.join(outDir, 'verbal-warning.pdf'));

    const contract = await checkPdfContract(pdf, {
      label: 'verbal-warning',
      pages: 1,
      draft: false,
      mustContain: [
        'Randy Speer', 'J. Alvarez', 'Flagger',
        'Verbal Warning — No Employee Signature Required',
        'Spoke out disruptively during the morning safety meeting after another employee was corrected about turning in a radio.',
        'Raise concerns privately with a supervisor instead of talking back during group meetings.',
        // Section 5 keeps its original number (no renumbering) even though
        // section 4 is skipped for Verbal.
        '5. CORRECTIVE ACTION THAT MUST BE TAKEN BY THE EMPLOYEE',
      ],
      mustNotContain: ['EMPLOYEE STATEMENT'],
    });
    contract.forEach(r => check(r.ok, r.label));
    // Logo + manager signature only -- no employee signature image.
    check(pdf.pages[0].images.length === 2, `Only logo + manager signature embedded, no employee signature (found ${pdf.pages[0].images.length} images)`);

    check(consoleErrors.length === 0, `No console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
    check(pageErrors.length === 0, `No page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

    await page.evaluate(key => window.localStorage.removeItem(key), STORAGE_KEY);
    await context.close();
    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[3/3] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) {
    console.log('--- preview server output (tail) ---');
    console.log(serverOutput.slice(-2000));
    process.exit(1);
  }
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
