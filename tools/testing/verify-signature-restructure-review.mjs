// Review-evidence run for the 2026-08-29 staff-only-signatures pass across
// Disciplinary, Separation, Medical Event, Uncontrolled Event: content ->
// Review -> Signatures -> Finish & Export stays, but the "sign in person"
// toggles from the 2026-08-28 pass are gone. Only Superintendent/Foreman/
// Safety-role signatures are captured in-app now (Manager on Disciplinary,
// Supervisor on Separation/Medical Event, Reported By + Supervisor Review on
// Uncontrolled Event) -- the employee (and HR on Separation) always sign a
// printed copy by hand; the app never offers a way to capture that
// digitally. Not a regression suite -- this is evidence-gathering for
// CLAUDE.md's mandatory screenshot/PDF review step.
//   node tools/testing/verify-signature-restructure-review.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { downloadGeneratedPdf } from './lib/downloadPdf.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'signature-restructure-v2');
mkdirSync(outDir, { recursive: true });

const PORT = 4327;
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

async function drawSignature(page) {
  const canvas = page.locator('canvas.signatureCanvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 10, { steps: 8 });
  await page.mouse.up();
  await page.locator('.signaturePadActions button', { hasText: /^Save$/ }).first().click();
}

async function main() {
  console.log('Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ═══════════════════════ DISCIPLINARY ═══════════════════════
    console.log('\n=== Disciplinary ===');
    {
      const dir = path.join(outDir, 'disciplinary'); mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');
      check(await page.locator('label.field', { hasText: 'Employee Statement' }).count() === 0, 'No "Employee Statement" input anywhere on Notice Details (removed per 2026-08-29 decision)');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill("D'Andre O'Shea-Ruiz");
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('J. Kowalcyzk');
      await page.getByRole('button', { name: 'Written Warning', exact: true }).click();
      await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('showed up 40 min late again, 3rd time this month, no call');

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Corrective Action');
      await page.getByRole('textbox', { name: 'What must the employee do to correct this?', exact: true }).fill('be on time or call 30 min ahead min');

      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Readiness');
      await page.screenshot({ path: path.join(dir, '1-review-step.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Signatures' }).click();
      await page.waitForSelector('text=Manager signs here');
      check(await page.locator('.signaturePad', { hasText: 'Employee Signature' }).count() === 0, 'No Employee SignaturePad on the Signature step (staff-only capture)');
      await page.locator('.signaturePad', { hasText: 'Manager Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);
      await page.screenshot({ path: path.join(dir, '2-signature-step-manager-only.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Finish & Export' }).click();
      await page.waitForSelector('text=Readiness');
      await page.getByRole('button', { name: /Create Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { savedTo: draftPdf } = await downloadGeneratedPdf(page, path.join(dir, 'draft.pdf'));
      console.log('  Draft PDF ->', draftPdf);

      await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.waitForTimeout(300);
      const badge = (await page.locator('.builderHeaderBadges .badge').innerText()).trim();
      check(badge.toLowerCase() === 'completed', `Badge reads plain "Completed" (no paper-pending concept anymore) (got "${badge}")`);
      check(await page.locator('.card', { hasText: 'Waiting on a paper signature' }).count() === 0, 'No "Waiting on a paper signature" card (removed)');

      await page.getByRole('button', { name: /Update Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { savedTo: finalPdf } = await downloadGeneratedPdf(page, path.join(dir, 'final.pdf'));
      console.log('  Final PDF ->', finalPdf);

      check(pageErrors.length === 0, `No page errors (${pageErrors.length})${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
      await page.evaluate(() => window.localStorage.removeItem('sdc.discipline.draft.v1'));
      await context.close();
    }

    // ═══════════════════════ SEPARATION ═══════════════════════
    console.log('\n=== Separation ===');
    {
      const dir = path.join(outDir, 'separation'); mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Separation' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Separation Details');

      const sigTab = page.getByRole('tab', { name: /^Signature:/ });
      const sigTabClass = await sigTab.getAttribute('class');
      check(/locked/.test(sigTabClass || ''), `Signature tab still locked before content is filled in (class="${sigTabClass}")`);

      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Tre\'von Nguyen-Baptiste');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('M. Ostrowski');
      await page.getByRole('button', { name: 'Voluntary', exact: true }).click();
      await page.getByRole('button', { name: 'Resignation', exact: true }).click();
      await page.getByRole('textbox', { name: 'Explain what happened' }).fill('quit, took a job closer to home, 2 wk notice given verbally');

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Rehire Status');
      await page.locator('.field', { hasText: 'Eligible for rehire?' }).getByRole('button', { name: 'Yes', exact: true }).click();

      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Readiness');
      await page.screenshot({ path: path.join(dir, '1-review-step.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Signatures' }).click();
      await page.waitForSelector('text=Supervisor signs here');
      check(await page.locator('.signaturePad', { hasText: 'Employee Signature' }).count() === 0, 'No Employee SignaturePad (staff-only capture)');
      check(await page.locator('.signaturePad', { hasText: 'HR' }).count() === 0, 'No HR SignaturePad (staff-only capture)');
      await page.locator('.signaturePad', { hasText: 'Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);
      await page.getByRole('textbox', { name: 'HR / Management Name', exact: true }).fill('B. Alvarez (HR)');
      await page.screenshot({ path: path.join(dir, '2-signature-step-supervisor-only.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Finish & Export' }).click();
      await page.waitForSelector('text=Readiness');
      await page.getByRole('button', { name: /Create Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { savedTo: draftPdf } = await downloadGeneratedPdf(page, path.join(dir, 'draft.pdf'));
      console.log('  Draft PDF ->', draftPdf);

      await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.waitForTimeout(300);
      const badge = (await page.locator('.builderHeaderBadges .badge').innerText()).trim();
      check(badge.toLowerCase() === 'completed', `Badge reads plain "Completed" (got "${badge}")`);

      await page.getByRole('button', { name: /Update Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { savedTo: finalPdf } = await downloadGeneratedPdf(page, path.join(dir, 'final.pdf'));
      console.log('  Final PDF ->', finalPdf);

      check(pageErrors.length === 0, `No page errors (${pageErrors.length})${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
      await page.evaluate(() => window.localStorage.removeItem('sdc.separation.draft.v1'));
      await context.close();
    }

    // ═══════════════════════ MEDICAL EVENT ═══════════════════════
    console.log('\n=== Medical Event ===');
    {
      const dir = path.join(outDir, 'medical-event'); mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Medical Event' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event & Response');
      await page.getByRole('textbox', { name: 'Employee Name', exact: true }).fill('Q. Featherstone-Diaz');
      await page.getByRole('textbox', { name: 'Supervisor', exact: true }).fill('R. Villanueva');
      await page.getByRole('textbox', { name: 'What symptoms or concerns did the employee report?' }).fill('dizzy, said it was hot out, sat down on his own');
      await page.getByRole('button', { name: 'During Work', exact: true }).click();
      await page.getByRole('button', { name: 'No', exact: true }).click();

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Evaluation & Classification');
      await page.getByRole('button', { name: 'Non-Occupational Medical Event', exact: true }).click();

      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Readiness');
      await page.screenshot({ path: path.join(dir, '1-review-step.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Signatures' }).click();
      await page.waitForSelector('text=Safety/Supervisor signs here');
      check(await page.locator('.signaturePad', { hasText: 'Employee' }).count() === 0, 'No Employee SignaturePad (staff-only capture)');
      await page.locator('.signaturePad', { hasText: 'Safety / Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);
      await page.screenshot({ path: path.join(dir, '2-signature-step-supervisor-only.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Finish & Export' }).click();
      await page.waitForSelector('text=Readiness');
      await page.getByRole('button', { name: /Create Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { savedTo: draftPdf } = await downloadGeneratedPdf(page, path.join(dir, 'draft.pdf'));
      console.log('  Draft PDF ->', draftPdf);

      await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.waitForTimeout(300);
      const badge = (await page.locator('.builderHeaderBadges .badge').innerText()).trim();
      check(badge.toLowerCase() === 'completed', `Badge reads plain "Completed" (got "${badge}")`);

      check(pageErrors.length === 0, `No page errors (${pageErrors.length})${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
      await page.evaluate(() => window.localStorage.removeItem('sdc.medical.draft.v1'));
      await context.close();
    }

    // ═══════════════════════ UNCONTROLLED EVENT ═══════════════════════
    console.log('\n=== Uncontrolled Event ===');
    {
      const dir = path.join(outDir, 'uncontrolled-event'); mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Uncontrolled Event' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Event Info & Classification');
      await page.getByRole('textbox', { name: 'Workplace Location / Project', exact: true }).fill('substation yard, laydown area B');
      await page.getByRole('button', { name: 'Weather / Natural (wind, lightning, flood, heat/cold)', exact: true }).click();
      await page.getByRole('button', { name: 'Near Miss (no damage/injury)', exact: true }).click();

      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForSelector('text=Narrative & Notifications');
      await page.getByRole('textbox', { name: 'What Happened / Brief Summary / Timeline' }).fill('gust knocked over a stack of empty spools, nobody near it, no damage');
      await page.getByRole('textbox', { name: 'Reported By — Name', exact: true }).fill("Sha'quille Brennan-Yoon");

      await page.getByRole('button', { name: 'Go to Review' }).click();
      await page.waitForSelector('text=Readiness');
      await page.screenshot({ path: path.join(dir, '1-review-step.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Signatures' }).click();
      await page.waitForSelector('text=Reported By and Supervisor Review sign here');
      await page.locator('.signaturePad', { hasText: 'Reported By Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);
      await page.locator('.signaturePad', { hasText: 'Supervisor Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawSignature(page);
      await page.screenshot({ path: path.join(dir, '2-signatures-step-both-staff.png'), fullPage: true });

      await page.getByRole('button', { name: 'Go to Finish & Export' }).click();
      await page.waitForSelector('text=Readiness');
      await page.getByRole('button', { name: /Create Document/ }).click();
      await page.waitForSelector('.pdfReadyPanel', { timeout: 30000 });
      const { savedTo: draftPdf } = await downloadGeneratedPdf(page, path.join(dir, 'draft.pdf'));
      console.log('  Draft PDF ->', draftPdf);

      await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.locator('.dialogPanel', { hasText: 'Mark this document complete?' }).getByRole('button', { name: 'Mark Complete', exact: true }).click();
      await page.waitForTimeout(300);
      const badge = (await page.locator('.builderHeaderBadges .badge').innerText()).trim();
      check(badge.toLowerCase() === 'completed', `Badge reads plain "Completed" (got "${badge}")`);

      check(pageErrors.length === 0, `No page errors (${pageErrors.length})${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
      await page.evaluate(() => window.localStorage.removeItem('sdc.uncontrolled.draft.v1'));
      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\nDone. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
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
