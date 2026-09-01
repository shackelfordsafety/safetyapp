// Verifies the 2026-09-01 fix: "Ready for Crew to Sign" (Review step) must
// land on the Signatures step and show the Kiosk / Print & Sign in Pen
// toggle, NOT auto-open the CrewSignInKiosk modal. Also confirms the
// "Start Crew Sign-In" button on that screen still opens the kiosk.
//
// node tools/testing/verify-ready-to-sign-prompt.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'ready-to-sign-prompt');
mkdirSync(outDir, { recursive: true });

const jsaDraft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');
JSON.parse(jsaDraft);

const PORT = 4325;
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
  console.log('[1] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const checks = [];
  function check(cond, msg) { checks.push({ ok: !!cond, msg }); console.log(`    [${cond ? 'PASS' : 'FAIL'}] ${msg}`); }

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    await context.addInitScript((json) => { window.localStorage.setItem('sdc.jsa.draft.v4', json); }, jsaDraft);
    const page = await context.newPage();

    console.log('[3] Loading app, navigating to Review step...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.getByRole('tab', { name: /^Review/ }).click();
    await page.locator('button:has-text("Ready for Crew to Sign")').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(outDir, '01-review-step.png') });

    console.log('[4] Clicking "Ready for Crew to Sign"...');
    page.once('dialog', (d) => d.accept());
    await page.locator('button:has-text("Ready for Crew to Sign")').click();

    // Give any (unwanted) auto-open a moment to happen before asserting.
    await page.waitForTimeout(500);
    const kioskVisible = await page.locator('.crewKiosk').isVisible().catch(() => false);
    check(!kioskVisible, 'Kiosk modal did NOT auto-open after "Ready for Crew to Sign"');

    const onSignaturesStep = await page.locator('text=How will this JSA be signed?').isVisible().catch(() => false);
    check(onSignaturesStep, 'Landed on Signatures step showing the Kiosk / Print & Sign in Pen toggle');
    await page.screenshot({ path: path.join(outDir, '02-signatures-step-prompt.png') });

    console.log('[5] Confirming "Start Crew Sign-In" still opens the kiosk...');
    await page.getByRole('button', { name: 'Start Crew Sign-In' }).click();
    await page.locator('.crewKiosk').waitFor({ state: 'visible', timeout: 3000 });
    check(true, 'Kiosk opens correctly when explicitly requested via "Start Crew Sign-In"');
    await page.screenshot({ path: path.join(outDir, '03-kiosk-opens-on-request.png') });

    await browser.close();

    const summary = { generatedAt: new Date().toISOString(), outDir, checks, failCount: checks.filter(c => !c.ok).length };
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failCount > 0) {
      console.error('\nFAILED: see summary above.');
      process.exitCode = 1;
    }
  } finally {
    killTree(server);
  }
}

main().then(() => {
  process.exit(process.exitCode || 0);
}).catch((err) => {
  console.error('Verification script failed:', err);
  process.exitCode = 1;
});
