// THROWAWAY verification script (2026-08-19 kiosk-flow overhaul, per
// Fonzo's iPad field feedback):
//   1. Signatures/Finish & Export show a LOCKED state (not green "Done")
//      in the step nav when Job/Meeting/Work aren't complete.
//   2. StepNav collapses to a compact horizontal strip on iPad instead of
//      a tall vertical list.
//   3. A complete draft's Review step shows the decluttered "all good"
//      banner instead of the 8-box checklist grid.
//   4. "Ready for Crew to Sign" opens the kiosk directly -- no
//      intermediate "how many signature lines" screen.
//   5. Ending sign-in shows a "Done Signing? / Continue Signing" choice;
//      Continue Signing resumes; Done Signing sets signatureLineCount to
//      20 and advances straight to Finish & Export.
//   6. The full print preview pager is genuinely fullscreen now.
//   7. The real generated PDF still reflects all of this correctly.

import { chromium, devices } from 'playwright';
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

const PORT = 4326;
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

async function drawSignature(page, canvasLocator) {
  const box = await canvasLocator.boundingBox();
  const x0 = box.x + box.width * 0.15;
  const y0 = box.y + box.height * 0.5;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(x0 + i * (box.width * 0.08), y0 + Math.sin(i) * box.height * 0.1);
  }
  await page.mouse.up();
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

    // ── Case 1: blank draft on iPad -- locked steps + compact nav ──
    {
      const context = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[blank] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[blank] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Documents', exact: true }).click();
      await page.locator('.listItem', { hasText: 'Job Safety Analysis' }).getByRole('button', { name: 'Start' }).click();
      await page.getByRole('button', { name: 'Start Blank', exact: false }).first().click();
      await page.waitForTimeout(300);

      const sigRow = page.locator('.stepNavRow', { hasText: 'Signatures' });
      const sigClass = await sigRow.getAttribute('class');
      check(sigClass.includes('locked'), `Signatures row is "locked" on a blank draft (class="${sigClass}")`);
      check(!sigClass.includes('done'), `Signatures row is NOT "done" on a blank draft (class="${sigClass}")`);
      const navListBox = await page.locator('.stepNavList').boundingBox();
      check(navListBox.height < 150, `Step nav is compact on iPad, not a tall vertical list (height=${Math.round(navListBox.height)}px)`);
      await page.screenshot({ path: path.join(outDir, 'kiosk-flow-01-blank-ipad-stepnav.png') });
      await context.close();
    }

    // ── Case 2: complete draft, full new signing flow ──
    {
      const context = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
      await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, completeDraft);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[complete] ${m.text()}`); });
      page.on('pageerror', (e) => pageErrors.push(`[complete] ${e.message}`));
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Continue JSA' }).click();
      await page.getByRole('tab', { name: /^Review/ }).click();
      await page.waitForTimeout(300);

      check(await page.locator('.reviewAllGoodBanner').isVisible(), 'Complete draft shows the decluttered "all good" banner on Review');
      check(!(await page.locator('.reviewChecklist').count()), 'The 8-box checklist grid is NOT shown when everything already passes');
      await page.screenshot({ path: path.join(outDir, 'kiosk-flow-02-review-allgood.png') });

      // Fullscreen pager check.
      await page.locator('.previewViewAllBtn').click();
      await page.waitForTimeout(300);
      const pagerBox = await page.locator('.previewPagerPanel').boundingBox();
      const viewport = page.viewportSize();
      check(pagerBox.width >= viewport.width * 0.95 && pagerBox.height >= viewport.height * 0.9, `Preview pager is genuinely fullscreen (panel ${Math.round(pagerBox.width)}x${Math.round(pagerBox.height)} vs viewport ${viewport.width}x${viewport.height})`);
      await page.screenshot({ path: path.join(outDir, 'kiosk-flow-03-fullscreen-pager.png') });
      await page.locator('.actionSheetCloseBtn').click();
      await page.waitForTimeout(200);

      // "Ready for Crew to Sign" should open the kiosk directly.
      await page.getByRole('button', { name: 'Ready for Crew to Sign' }).first().click();
      await page.waitForTimeout(300);
      check(await page.locator('.crewKiosk').isVisible(), '"Ready for Crew to Sign" opens the kiosk directly (no intermediate line-count screen)');
      await page.screenshot({ path: path.join(outDir, 'kiosk-flow-04-kiosk-opened-direct.png') });

      // Sign one person.
      const canvas = page.locator('.crewKioskCanvas');
      await drawSignature(page, canvas);
      await page.getByRole('button', { name: 'Confirm & Next' }).click();
      await page.waitForTimeout(1500);

      // Tap End Sign-In -- should show the Done Signing?/Continue Signing choice, not exit immediately.
      await page.locator('.crewKioskExitHold').click();
      await page.waitForTimeout(200);
      check(await page.locator('.crewKioskExitConfirmOverlay').isVisible(), 'Tapping End Sign-In shows the "Done signing?" choice instead of exiting immediately');
      await page.screenshot({ path: path.join(outDir, 'kiosk-flow-05-done-signing-prompt.png') });

      // Continue Signing should dismiss back to signing mode, not exit.
      await page.locator('.crewKioskExitConfirmOverlay').getByRole('button', { name: 'Continue signing' }).click();
      await page.waitForTimeout(200);
      check(await page.locator('.crewKiosk').isVisible(), '"Continue signing" stays in the kiosk (does not exit)');
      check(!(await page.locator('.crewKioskExitConfirmOverlay').count()), '"Continue signing" dismisses the confirm overlay');

      // Now actually finish.
      await page.locator('.crewKioskExitHold').click();
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: 'Done signing' }).click();
      await page.waitForTimeout(300);
      check(!(await page.locator('.crewKiosk').count()), '"Done signing" actually closes the kiosk');
      const landedStep = (await page.locator('.stepNavRow.current strong').innerText()).toLowerCase();
      check(landedStep === 'finish & export', `Closing the kiosk via "Done signing" advances straight to Finish & Export (landed on "${landedStep}")`);
      await page.screenshot({ path: path.join(outDir, 'kiosk-flow-06-landed-on-export.png') });

      console.log('    Generating real PDF...');
      await page.locator('.reviewPrimaryAction button').click();
      await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.pdfReadyPanel button:has-text("Download")').click();
      const download = await downloadPromise;
      await download.saveAs(path.join(outDir, 'jsa-kiosk-flow-generated.pdf'));
      console.log('    Saved -> jsa-kiosk-flow-generated.pdf');

      await page.addStyleTag({ content: `.pdfExportRoot { position: static !important; left: 0 !important; top: 0 !important; } .pdfExportRoot .printPage { margin: 0 0 24px !important; box-shadow: 0 0 0 1px #ccc; }` });
      const mainPage = page.locator('.pdfExportRoot .mainJsaPage').first();
      await mainPage.screenshot({ path: path.join(outDir, 'kiosk-flow-07-pdf-main-page.png') });
      const signInPageEl = page.locator('.pdfExportRoot .signInPage').first();
      if (await signInPageEl.count()) {
        await signInPageEl.screenshot({ path: path.join(outDir, 'kiosk-flow-08-pdf-signin-page.png') });
      }

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
