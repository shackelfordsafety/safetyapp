// The Signatures step of Disciplinary, Separation and Medical Event, as a
// new person sees it: empty, then each "how are they signing?" answer.
// Light and dark, iPad width.
//
//   node tools/testing/capture-signature-steps.mjs [outDir]
//
// Fonzo, 2026-09-28, on the old versions: "looks like a bunch of word slop
// on a page".

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'signature-steps');
mkdirSync(outDir, { recursive: true });

const PORT = 4475;
const BASE = `http://localhost:${PORT}`;
const fx = n => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const blankSigner = {
  employeeSignMethod: '', employeeResponseAt: '', employeeSignatureData: null, employeeRefusedToSign: false,
  witnessSignatureData: null, witnessName: '', employeeStatement: '',
};
const DOCS = [
  { name: 'disciplinary', key: 'sdc.discipline.draft.v1', model: { ...fx('disciplinary-normal.json'), ...blankSigner, status: 'draft' } },
  { name: 'separation', key: 'sdc.separation.draft.v1', model: { ...fx('separation-stress-allsigs.json'), ...blankSigner, rehireReasonIfNo: 'no call no show x3', status: 'draft' } },
  { name: 'medical', key: 'sdc.medical.draft.v1', model: { ...fx('medical-non-occupational.json'), employeeSignMethod: '', employeeResponseAt: '', employeeSignatureData: null, status: 'draft' } },
];

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
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  for (const theme of ['light', 'dark']) {
    for (const d of DOCS) {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
      await ctx.addInitScript(([k, j, t]) => {
        localStorage.setItem(k, j);
        localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: t }));
      }, [d.key, JSON.stringify(d.model), theme]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: /^Continue/ }).first().click();
      await page.waitForTimeout(1000);
      await page.locator('.stepNav button', { hasText: /SIGNATURE/i }).first().click();
      await page.waitForTimeout(900);
      const snap = async label => {
        await page.screenshot({ path: path.join(outDir, `${d.name}-${theme}-${label}.png`), fullPage: true });
        console.log(`  ${d.name}-${theme}-${label}.png`);
      };
      await snap('1-empty');
      if (theme === 'light') {
        for (const [btn, label] of [['On this device', '2-device'], ['On their own phone', '3-phone'], ['They are not signing', '4-none']]) {
          await page.getByRole('button', { name: btn, exact: true }).click();
          await page.waitForTimeout(500);
          await snap(label);
        }
      } else {
        await page.getByRole('button', { name: 'On this device', exact: true }).click();
        await page.waitForTimeout(500);
        await snap('2-device');
      }
      await page.locator('.stepNav button', { hasText: /SUBMIT/i }).first().click();
      await page.waitForTimeout(900);
      await snap('5-submit');
      if (errors.length) console.log('  PAGE ERRORS:', errors.join(' | '));
      await ctx.close();
    }
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
} finally {
  killTree(server);
  process.exit(0);
}
