// Review evidence for removing the saved-job picker (2026-09-22).
//
// One screen: the JSA's Job Info step. The thing to check is not that the
// picker is gone -- it is that the "Job #" field is untouched and still
// takes typing, because that field binds straight to jsa.jobNumber and
// never went through the job list at all.
//
// A warning for anybody using this as a before/after: the picker rendered
// `null` whenever the job list was empty or nobody was signed in
// (`if (!state.ready || state.jobs.length === 0) return null`). So a
// signed-out run photographs an identical screen before and after the
// removal, and "job picker present: false" is not on its own evidence that
// anything was removed. Getting a real visual before/after would mean
// stubbing auth and the jobs module the way the retired
// verify-job-picker.mjs did. The assertion below that actually carries
// weight is the one about typing.
//
// Usage (redirect on Windows, per CLAUDE.md):
//   node tools/testing/capture-job-info-step.mjs before > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2] || 'after';
const outDir = path.join(HERE, 'output', 'job-info-step', LABEL);
const BASE = 'http://localhost:4173/';

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npm', ['run', 'preview', '--', '--port', '4173'], {
    cwd: path.join(HERE, '..', '..'), shell: true, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 4000));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1180, height: 1000 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    // Straight into a blank JSA.
    await page.getByRole('button', { name: /Job Safety Analysis|Start/i }).first().click();
    await page.waitForTimeout(700);
    const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
    if (await blank.count()) { await blank.click(); await page.waitForTimeout(900); }

    await page.waitForSelector('text=Job Information', { timeout: 15000 });
    await page.waitForTimeout(500);

    console.log(`  job picker present: ${(await page.locator('.jobPick').count()) > 0}`);

    // The real point of this check: the field still takes typing.
    const jobField = page.locator('label').filter({ hasText: 'Job #' }).locator('input').first();
    await jobField.fill('480-02');
    await page.waitForTimeout(300);
    console.log(`  Job # field accepts typing: ${JSON.stringify(await jobField.inputValue())}`);

    await page.locator('.stepPanel').first().screenshot({ path: path.join(outDir, 'job-info.png') });
    console.log('  shot: job-info.png');

    console.log(errors.length ? `\n!! PAGE ERRORS: ${errors.join(' | ')}` : '\nno page errors');
    await context.close();
  } catch (err) {
    /* Without this, the process.exit(0) below runs first and the error
       never reaches main()'s .catch -- the script "succeeds" silently with
       no screenshot, which is exactly what it did the first time. */
    console.error('\n!! FAILED: ' + (err?.message || err));
  } finally {
    await browser.close().catch(() => {});
    killTree(server);
    console.log(`\nscreenshot in ${outDir}`);
    process.exit(0);
  }
}

main().catch(err => { console.error('capture crashed:', err); process.exit(1); });
