// Does the "on their own phone" QR show up for every disciplinary warning
// level -- and exactly where it should not?
//
//   node tools/testing/verify-disciplinary-levels-handoff.mjs [outDir]
//
// Fonzo, 2026-09-28: tried a disciplinary as a first-time warning and never
// saw the QR. For each level this seeds the same notice, walks to
// Signatures, answers "On their own phone", and records what is on screen.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'disciplinary-levels');
mkdirSync(outDir, { recursive: true });

const PORT = 4473;
const BASE = `http://localhost:${PORT}`;
const KEY = 'sdc.discipline.draft.v1';
const BASE_DRAFT = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'disciplinary-normal.json'), 'utf8'));
const LEVELS = ['verbal', 'written', 'secondWritten', 'final'];

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => fetch(url).then(() => resolve()).catch(() => {
      if (Date.now() > deadline) reject(new Error('server not ready'));
      else setTimeout(tryOnce, 300);
    });
    tryOnce();
  });
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const results = [];
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  for (const level of LEVELS) {
    for (const [vpName, vp] of [['ipad', { width: 820, height: 1180, hasTouch: true, isMobile: true }], ['desktop', { width: 1440, height: 900 }]]) {
      const { width, height, ...rest } = vp;
      const ctx = await browser.newContext({ viewport: { width, height }, ...rest });
      const draft = {
        ...BASE_DRAFT, warningLevel: level, status: 'draft',
        employeeSignMethod: '', employeeResponseAt: '', employeeSignatureData: null, employeeRefusedToSign: false,
      };
      await ctx.addInitScript(([k, j]) => localStorage.setItem(k, j), [KEY, JSON.stringify(draft)]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: /^Continue/ }).first().click();
      await page.waitForTimeout(1000);
      await page.locator('.stepNav button', { hasText: /SIGNATURE/i }).first().click();
      await page.waitForTimeout(900);

      const askShown = await page.getByText('How is the employee signing?').count() > 0;
      let offerShown = false;
      if (askShown) {
        await page.getByRole('button', { name: 'On their own phone', exact: true }).click();
        await page.waitForTimeout(900);
        offerShown = await page.getByRole('button', { name: /Show the code/i }).count() > 0;
      }
      await page.screenshot({ path: path.join(outDir, `${level}-${vpName}.png`), fullPage: true });
      results.push({ level, vpName, askShown, offerShown, errors: errors.length });
      await ctx.close();
    }
  }
  /* Real PDFs of a verbal warning -- draft, and final (approved) -- with
     the employee's statement and signature on it, since 2026-09-28 is the
     first time a verbal warning prints either. */
  for (const [name, extra] of [['verbal-draft', { status: 'draft' }], ['verbal-final', { status: 'ready' }]]) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
    const draft = {
      ...BASE_DRAFT, ...extra, warningLevel: 'verbal',
      employeeStatement: 'ok. i didnt know the shelter rule applied to the yard, wont happen again',
      employeeSignMethod: 'device', employeeRefusedToSign: false,
      employeeSignatureData: BASE_DRAFT.managerSignatureData, employeeSignatureDate: '2026-09-28',
    };
    await ctx.addInitScript(([k, j]) => localStorage.setItem(k, j), [KEY, JSON.stringify(draft)]);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('tab').last().click();
    await page.waitForTimeout(600);
    await page.locator('.reviewPrimaryAction button, button:has-text("Want a paper copy first?"), button:has-text("Update the printout")').first().click();
    await page.locator('.pdfReadyPanel').waitFor({ timeout: 120000 });
    const dl = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /download/i }).first().click();
    await (await dl).saveAs(path.join(outDir, `${name}.pdf`));
    console.log(`  ${name}.pdf`);
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
} finally {
  console.table(results);
  killTree(server);
  process.exit(0);
}
