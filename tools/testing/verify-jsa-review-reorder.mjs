// THROWAWAY verification script (2026-08-19 JSA step reorder: Review moved
// before Signatures, Finish & Export trimmed to pure export mechanics, and
// a step-lock added so Signatures/Export can't be reached before
// Job/Meeting/Work are actually filled in).
//
// Confirms, against the real production build:
//   1. Step nav shows the new 6-step order with the right labels.
//   2. A blank draft can't jump straight to Signatures or Finish & Export
//      via the sidebar -- it gets redirected back to the first incomplete
//      step instead (Job Info).
//   3. A complete draft's Review step shows the checklist all-green and
//      "Ready for Crew to Sign" advances straight to Signatures with no
//      confirm prompt.
//   4. The full path (Review -> Signatures -> kiosk sign -> Finish &
//      Export -> Create Document -> Download) still produces a correct
//      real PDF.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

const completeDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

const PORT = 4323;
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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const consoleErrors = [];
  const pageErrors = [];
  const checks = [];
  function check(cond, msg) { checks.push({ ok: !!cond, msg }); console.log(`    [${cond ? 'PASS' : 'FAIL'}] ${msg}`); }

  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();

    // ── Case 1: step nav order/labels + step-lock on a blank draft ──
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[blank] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[blank] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Job Safety Analysis' }).getByRole('button', { name: 'Start' }).click();
      await page.getByRole('button', { name: 'Start Blank', exact: false }).first().click();
      await page.waitForTimeout(300);

      // .stepNavRow renders labels with CSS text-transform: uppercase --
      // innerText() reflects rendered casing, not the raw JSX string, so
      // compare case-insensitively.
      const navLabels = (await page.locator('.stepNavRow strong').allInnerTexts()).map(t => t.toLowerCase());
      const expectedLabels = ['Job Info', 'Meeting Info', 'Tasks / Hazards', 'Review', 'Signatures', 'Finish & Export'].map(t => t.toLowerCase());
      check(
        JSON.stringify(navLabels) === JSON.stringify(expectedLabels),
        `Step nav order is Job, Meeting, Tasks, Review, Signatures, Finish & Export (got ${JSON.stringify(navLabels)})`
      );
      await page.screenshot({ path: path.join(outDir, 'reorder-blank-stepnav.png'), fullPage: true });

      // Try to jump straight to Signatures from Job Info on a blank draft.
      await page.getByRole('tab', { name: /^Signatures/ }).click();
      await page.waitForTimeout(300);
      const activeAfterSigJump = (await page.locator('.stepNavRow.current strong').innerText()).toLowerCase();
      check(activeAfterSigJump === 'job info', `Jumping to Signatures on a blank draft redirects back to Job Info (landed on "${activeAfterSigJump}")`);

      // Try to jump straight to Finish & Export too.
      await page.getByRole('tab', { name: /Finish|Submit/i }).click();
      await page.waitForTimeout(300);
      const activeAfterExportJump = (await page.locator('.stepNavRow.current strong').innerText()).toLowerCase();
      check(activeAfterExportJump === 'job info', `Jumping to Finish & Export on a blank draft redirects back to Job Info (landed on "${activeAfterExportJump}")`);
      await page.screenshot({ path: path.join(outDir, 'reorder-blank-guard-redirect.png'), fullPage: true });
      await context.close();
    }

    // ── Case 2: complete draft, full Review -> Signatures -> kiosk -> Export path ──
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, completeDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[complete] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[complete] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Review/ }).click();
      await page.waitForTimeout(300);

      const scorePct = await page.locator('.reviewScore').innerText();
      check(scorePct.includes('100%'), `Complete draft's Review checklist is 100% (got "${scorePct}")`);
      await page.screenshot({ path: path.join(outDir, 'reorder-review-step-complete.png'), fullPage: true });

      // No dialog should appear for a complete draft -- fail loudly if one does.
      let dialogFired = false;
      page.once('dialog', async (d) => { dialogFired = true; await d.dismiss(); });
      await page.getByRole('button', { name: 'Ready for Crew to Sign' }).click();
      await page.waitForTimeout(400);
      check(!dialogFired, 'No confirm dialog on a complete draft\'s "Ready for Crew to Sign"');
      const activeStep = (await page.locator('.stepNavRow.current strong').innerText()).toLowerCase();
      check(activeStep === 'signatures', `"Ready for Crew to Sign" advances straight to Signatures (landed on "${activeStep}")`);
      await page.screenshot({ path: path.join(outDir, 'reorder-signatures-step.png'), fullPage: true });

      // Sign one crew member via the kiosk.
      await page.getByRole('button', { name: 'Start Crew Sign-In' }).click();
      await page.locator('.crewKiosk').waitFor({ state: 'visible' });
      const canvas = page.locator('.crewKioskCanvas');
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
      await page.mouse.up();
      await page.getByRole('button', { name: 'Confirm & Next' }).click();
      await page.waitForTimeout(1500);
      await page.locator('.crewKioskExitHold').click();
      await page.locator('.crewKiosk').waitFor({ state: 'hidden' });

      await page.getByRole('tab', { name: /Finish|Submit/i }).click();
      await page.waitForTimeout(300);
      const exportBodyText = await page.locator('.stepStack').innerText();
      check(!exportBodyText.includes('checks complete'), 'Finish & Export no longer shows the readiness checklist (moved to Review)');
      await page.screenshot({ path: path.join(outDir, 'reorder-finish-export-step.png'), fullPage: true });

      console.log('    Generating real PDF...');
      await page.locator('.reviewPrimaryAction button').click();
      await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.pdfReadyPanel button:has-text("Download")').click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'jsa-reorder-generated.pdf'));
      console.log('    Saved -> jsa-reorder-generated.pdf');

      await page.addStyleTag({ content: `.pdfExportRoot { position: static !important; left: 0 !important; top: 0 !important; } .pdfExportRoot .printPage { margin: 0 0 24px !important; box-shadow: 0 0 0 1px #ccc; }` });
      const mainPage = page.locator('.pdfExportRoot .mainJsaPage').first();
      await mainPage.screenshot({ path: path.join(outDir, 'reorder-pdf-main-page.png') });

      await context.close();
    }

    await browser.close();

    console.log('\n=== SUMMARY ===');
    checks.forEach(c => console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.msg}`));
    console.log('Console errors:', consoleErrors);
    console.log('Page errors:', pageErrors);

    if (checks.some(c => !c.ok) || consoleErrors.length || pageErrors.length) {
      process.exitCode = 1;
    }
  } finally {
    killTree(server);
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
