// The step bar tells the truth on a blank form.
//
//   node tools/testing/verify-step-bar-honesty.mjs [outDir]
//
// Tidiness audit, 2026-09-28:
//   - Review showed a green check on a completely blank form, so the bar
//     read "1 of 5 done" before anybody typed anything.
//   - Tapping a locked step silently threw you onto another step with no
//     word about why.
// For each of the four FormPrimitives documents: start blank, check Review
// is not "Done", tap Signatures, check a message names what is missing.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'step-bar');
mkdirSync(outDir, { recursive: true });

const PORT = 4483;
const BASE = `http://localhost:${PORT}`;
const DOCS = ['Disciplinary', 'Separation', 'Medical Event', 'Uncontrolled Event'];

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

const results = [];
const check = (ok, msg) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  for (const doc of DOCS) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await page.waitForTimeout(600);
    await page.locator('.listItem', { hasText: doc }).first().getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1200);
    const review = page.locator('.stepNav button', { hasText: /REVIEW/i }).first();
    const reviewClass = await review.getAttribute('class');
    check(!/\bdone\b/.test(reviewClass || ''), `${doc}: Review is not "Done" on a blank form (${reviewClass})`);
    const head = await page.locator('.stepNavHead').innerText();
    check(/^Steps\s+—\s+0 of/i.test(head.trim()), `${doc}: step counter on a blank form reads "${head.trim()}"`);
    await page.locator('.stepNav button', { hasText: /SIGNATURE/i }).first().click();
    await page.waitForTimeout(700);
    const note = await page.locator('.stepNavLockedNote').count() ? await page.locator('.stepNavLockedNote').innerText() : '';
    check(/opens once the earlier steps are done/i.test(note), `${doc}: tapping locked Signatures says why — "${note.slice(0, 110)}${note.length > 110 ? '…' : ''}"`);
    await page.screenshot({ path: path.join(outDir, `${doc.toLowerCase()}-locked-tap.png`) });
    check(!errors.length, `${doc}: no page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
  results.push(false);
} finally {
  console.log(results.every(Boolean) ? '\nALL PASS' : '\nSOMETHING FAILED');
  killTree(server);
  process.exit(0);
}
