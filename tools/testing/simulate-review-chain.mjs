// The whole chain, driven end to end, so nobody has to click through it.
//
//   an author writes an incident report
//   -> Submit for review
//   -> an approver sees it in My Work
//   -> opens it (which must load the REAL record, not just a menu)
//   -> signs it off
//   -> it lands in the archive, owned by the AUTHOR, filed by the approver
//
// Fonzo, 2026-09-11: "can't you simulate this stuff instead of me having to
// go in manually and do it?" Yes. This needs two real accounts, which the
// caller creates and deletes around the run -- see the SQL in the session,
// and clean them up afterwards.
//
// Two browser contexts, never sharing a session, because the bug this is
// most likely to catch is one where something works for the person who
// wrote it and not for anybody else.
//
// Usage:
//   node tools/testing/simulate-review-chain.mjs <authorEmail> <approverEmail> <password>

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'reviewchain');
mkdirSync(outDir, { recursive: true });

const PORT = 4366;
const [authorEmail, approverEmail, password] = process.argv.slice(2);
if (!authorEmail || !approverEmail || !password) {
  console.error('Usage: node tools/testing/simulate-review-chain.mjs <authorEmail> <approverEmail> <password>');
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8'));
// A distinctive marker so the run can find its own document and clean up.
const MARK = `ZZSIM-${Date.now()}`;
fixture.id = `zzsim-${Date.now()}`;
fixture.workplaceLocation = MARK;
// The queue row is titled by employee_name (the injured party) and falls
// back to job_site, so the marker has to be on BOTH or the run cannot find
// its own document on screen. Cost me a false failure the first time.
fixture.injuredPartyName = MARK;
fixture.status = 'draft';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error('server not ready'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`Marker for this run: ${MARK}\n`);
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    const browser = await chromium.launch();

    /* ── The author ──────────────────────────────────────────────────── */
    const authorCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await authorCtx.addInitScript((json) => {
      window.localStorage.setItem('sdc.incident.draft.v1', json);
    }, JSON.stringify(fixture));
    const author = await authorCtx.newPage();
    const authorErrors = [];
    author.on('pageerror', e => authorErrors.push(String(e)));

    await author.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await author.waitForTimeout(900);
    await author.getByRole('button', { name: 'Continue Incident Report' }).click();
    await author.getByRole('tab', { name: /^Review & Export/ }).click();
    await author.waitForTimeout(700);

    // Submit. Not signed in, so it should ask -- and then finish the job.
    await author.getByRole('button', { name: /Submit for review/i }).first().click();
    await author.waitForTimeout(1500);
    await author.locator('input[type="email"]').first().fill(authorEmail);
    await author.locator('input[type="password"]').first().fill(password);
    await author.getByRole('button', { name: /Sign in and send/i }).click();

    const sent = await author.locator('.archiveFiled')
      .waitFor({ state: 'visible', timeout: 120000 }).then(() => true).catch(() => false);
    const sentText = sent ? await author.locator('.archiveFiled').innerText() : '';
    check('author signs in and the report goes up in one action', sent, sentText.replace(/\n/g, ' | '));
    await author.screenshot({ path: path.join(outDir, '01-author-sent.png'), fullPage: true });

    /* Submitting twice must NOT make a second report. This is the
       duplicate the outside reviewer found. */
    await author.reload({ waitUntil: 'networkidle' });
    await author.waitForTimeout(1200);
    await author.getByRole('button', { name: 'Continue Incident Report' }).click();
    await author.getByRole('tab', { name: /^Review & Export/ }).click();
    await author.waitForTimeout(700);
    const resubmit = author.getByRole('button', { name: /Submit for review/i }).first();
    if (await resubmit.count()) {
      await resubmit.click();
      await author.locator('.archiveFiled').waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
    }
    await author.waitForTimeout(1500);

    /* ── The approver ────────────────────────────────────────────────── */
    const approverCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const approver = await approverCtx.newPage();
    const approverErrors = [];
    approver.on('pageerror', e => approverErrors.push(String(e)));

    await approver.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await approver.waitForTimeout(900);

    // Sign in through Records, the one screen that always offers it.
    await approver.getByRole('button', { name: /^Records$/ }).first().click();
    await approver.waitForTimeout(1200);
    await approver.locator('input[type="email"]').first().fill(approverEmail);
    await approver.locator('input[type="password"]').first().fill(password);
    await approver.getByRole('button', { name: /^Sign In$/i }).click();
    await approver.waitForTimeout(3500);

    await approver.getByRole('button', { name: /^My Work$/ }).first().click();
    await approver.waitForTimeout(3500);

    const queueText = await approver.locator('body').innerText();
    check('the approver sees it waiting on him', /Waiting on you/i.test(queueText) && queueText.includes(MARK),
      /Waiting on you/i.test(queueText) ? 'in the "Waiting on you" section' : 'not in the queue');
    check('it was NOT duplicated by submitting twice',
      (queueText.match(new RegExp(MARK, 'g')) || []).length === 1,
      `${(queueText.match(new RegExp(MARK, 'g')) || []).length} copies on screen`);
    await approver.screenshot({ path: path.join(outDir, '02-approver-queue.png'), fullPage: true });

    // Opening it must load the real document, not just a menu.
    approver.once('dialog', d => d.accept());
    await approver.locator('.odRowMain').first().click();
    await approver.waitForTimeout(3500);
    const openedText = await approver.locator('body').innerText();
    check('opening it loads the real report, not the document menu',
      openedText.includes(MARK) && /Incident/i.test(openedText),
      openedText.split('\n').find(l => l.includes(MARK)) || 'marker not on screen');
    await approver.screenshot({ path: path.join(outDir, '03-approver-opened.png'), fullPage: true });

    // Back to My Work, and sign it off.
    await approver.getByRole('button', { name: /^My Work$/ }).first().click();
    await approver.waitForTimeout(3000);
    const signOff = approver.getByRole('button', { name: /Sign off/i }).first();
    check('the approver has a Sign off action', await signOff.count() > 0);
    if (await signOff.count()) {
      await signOff.click();
      await approver.waitForTimeout(5000);
    }
    await approver.screenshot({ path: path.join(outDir, '04-after-signoff.png'), fullPage: true });

    check('no console errors for the author', authorErrors.length === 0, authorErrors.join(' | '));
    check('no console errors for the approver', approverErrors.length === 0, approverErrors.join(' | '));

    await browser.close();
  } finally {
    killTree(server.pid);
  }

  const bad = results.filter(r => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  console.log(`\nNow check the database for marker ${MARK}:`);
  console.log('  - one row in public.documents, submitted_by = AUTHOR, filed_by = APPROVER');
  console.log('  - zero rows left in public.open_documents');
  if (bad.length) process.exit(1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
