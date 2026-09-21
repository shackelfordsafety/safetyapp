// Review evidence for the 2026-09-21 board sign-in wording pass.
//
// Four screens, in the order somebody actually hits them:
//   1. Home, the "out for signing" row   -- "40 of 60 signed" -> "40 signed"
//   2. The board card's button           -- "this iPad" -> "this device"
//   3. The kiosk header                  -- numbered queue -> "Sign Here"
//   4. The "Done signing?" dialog        -- the blank-lines promise, gone
//
// Runs the REAL built app. The board module is stubbed at the network layer
// (same trick verify-job-picker.mjs uses on jobsStore) so this needs no
// account and no Supabase -- the wording is the subject, not the database.
//
// Deliberately seeded with a 40/60 split: 40 people signed, signatureLineCount
// 60. That is the exact shape that invented twenty men who were never coming.
//
// Usage, per CLAUDE.md's note about piping deadlocking on Windows:
//   node tools/testing/capture-board-kiosk-wording.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2] || 'after';
const outDir = path.join(HERE, 'output', 'board-kiosk-wording', LABEL);
const BASE = 'http://localhost:4173/';

/* Enough of a published JSA for the board card and the kiosk to render.
   signatureLineCount is the one that matters: it is what Home used to read
   as an expected headcount. */
const ROW = {
  id: 'pub-1',
  area_label: 'Entergy Taps — North Laydown',
  job_site: 'Entergy Taps',
  location: 'Baytown, TX',
  job_number: '24-118',
  doc_date: '2026-09-21',
  published_at: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
  expires_at: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
  version: 1,
  client_doc_id: 'doc-1',
  pdf_path: null,
  signed: 40,
  live: true,
  data: {
    jobSite: 'Entergy Taps',
    location: 'Baytown, TX',
    jobNumber: '24-118',
    date: '2026-09-21',
    signatureLineCount: 60,
    crewSignatures: [],
    taskRows: [{ step: 'Marking boundaries / LODs', hazards: 'Struck-by; overhead utilities', controls: 'Spotter; 15 ft clearance' }],
  },
};

const STUB = `
  export class NotSignedInError extends Error {}
  export async function fetchMyBoard() {
    return { boardUrl: 'https://example.invalid/b/demo', rows: ${JSON.stringify([ROW])} };
  }
  export async function fetchSigners() { return []; }
  export async function signOnKiosk() { return { ok: true }; }
  export async function takeDownPublication() {}
  export function describeWindow() { return '1:30 PM'; }
  export function boardLabel(jsa) { return (jsa && jsa.jobSite) || 'Job Safety Analysis'; }
  export function boardUrlFor() { return 'https://example.invalid/b/demo'; }
  export async function fetchUnfiledExpired() { return []; }
  export async function fetchSignaturesForJsa() { return []; }
  export async function fetchSignatureCounts() { return {}; }
`;

/* Home's glance gives up the moment fetchFiledToday() returns null, which is
   how it asks "is the office half available to me" -- and a fake token in
   localStorage is not a real session, so without this the signing row never
   renders and the 40-of-60 line has nothing to appear on. */
const ARCHIVE_STUB = `
  export async function fetchFiledToday() { return []; }
  export async function signedUrlFor() { return null; }
  export async function fileToArchive() { return { ok: true }; }
  export async function fetchArchive() { return []; }
`;

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });
  console.log(`  shot: ${name}.png`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npm', ['run', 'preview', '--', '--port', '4173'], { cwd: path.join(HERE, '..', '..'), shell: true, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 4000));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true });
    await context.addInitScript(() => {
      localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { email: 'super@example.com', id: 'u1' } }));
    });
    await context.route(/\/assets\/board-.*\.js$/, r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB,
    }));
    await context.route(/\/assets\/fileToArchive-.*\.js$/, r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: ARCHIVE_STUB,
    }));

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // 1. Home's "out for signing" row.
    const signingRow = page.locator('.signingRow').first();
    if (await signingRow.count()) {
      console.log(`  home row reads: ${JSON.stringify((await signingRow.innerText()).replace(/\n/g, ' | '))}`);
      await shot(page, '1-home-signing-row');
    } else {
      console.log('  !! no .signingRow on Home');
    }

    // 2. The board, and the button on the card.
    await page.getByRole('button', { name: /^Sign-In$/ }).first().click();
    await page.waitForTimeout(1500);
    const cardBtn = page.locator('.brdCardRight button.btn').first();
    console.log(`  card button reads: ${JSON.stringify(await cardBtn.innerText())}`);
    await shot(page, '2-board-card');

    // 3. The kiosk itself.
    await cardBtn.click();
    await page.waitForTimeout(900);
    const head = page.locator('.crewKioskHead');
    console.log(`  kiosk header reads: ${JSON.stringify((await head.innerText()).replace(/\n/g, ' | '))}`);
    console.log(`  exit button reads: ${JSON.stringify(await page.locator('.crewKioskExitHoldLabel').innerText())}`);
    await shot(page, '3-kiosk-header');

    // Sign twice, so the on-this-device count is a real number and not zero.
    for (let i = 0; i < 2; i++) {
      const box = await page.locator('.crewKioskCanvas').boundingBox();
      await page.mouse.move(box.x + 40, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + box.height * 0.3, { steps: 8 });
      await page.mouse.move(box.x + 200, box.y + box.height * 0.7, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: /Confirm/i }).click();
      await page.waitForTimeout(1500);
    }
    console.log(`  after 2 signatures: ${JSON.stringify((await head.innerText()).replace(/\n/g, ' | '))}`);
    await shot(page, '4-kiosk-after-two');

    // 4. The exit dialog -- the one that used to promise 20 blank lines.
    await page.locator('.crewKioskExitHold').click();
    await page.waitForTimeout(600);
    const dlg = page.locator('.crewKioskExitConfirmPanel');
    console.log(`  exit dialog reads: ${JSON.stringify((await dlg.innerText()).replace(/\n/g, ' | '))}`);
    await shot(page, '5-exit-dialog');

    console.log(errors.length ? `\n!! PAGE ERRORS: ${errors.join(' | ')}` : '\nno page errors');
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    killTree(server);
    console.log(`\nscreenshots in ${outDir}`);
    process.exit(0);
  }
}

main().catch(err => { console.error('capture crashed:', err); process.exit(1); });
