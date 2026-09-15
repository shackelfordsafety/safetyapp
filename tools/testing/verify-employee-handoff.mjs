// The employee does his part on his own phone.
//
//   SDC_TEST_EMAIL=... SDC_TEST_PASSWORD=... node tools/testing/verify-employee-handoff.mjs
//
// Fonzo, 2026-09-15: "it gets to a step in the workflow where it's like,
// okay, this is what the employee needs to do, and it scans a QR code, and
// it gives them everything he needs to do... everything that an employee
// needs to do goes under one QR code." And why his phone rather than the
// company iPad: "just in case they're disgruntled or upset or whatever,
// they can't, like, trash the iPad."
//
// Nothing here is stubbed. Management signs in for real, clicks the real
// button, and the token comes out of the real QR panel. A SECOND browser
// context -- no account, no session, the way a scanned code arrives --
// opens it, reads the notice, writes a statement, signs, and sends it back.
//
// The security half matters as much as the happy path. A disciplinary is an
// accusation against a named person, so this also proves the link cannot be
// reused and shows nothing to somebody who invents a token -- the failure
// the 2026-09-11 audit found on published JSAs.
//
// WITHOUT CREDENTIALS THIS TESTS NOTHING AND SAYS SO. Creating a handoff is
// an authenticated write against the live database; there is no offline
// stand-in for it, and a version of this script that quietly stubbed one
// would report green while proving nothing. Three separate checks in this
// repo have already lied that way.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'employee');
mkdirSync(outDir, { recursive: true });

const PORT = 4468;
const BASE = `http://localhost:${PORT}`;

const EMAIL = process.env.SDC_TEST_EMAIL || process.argv[2];
const PASSWORD = process.env.SDC_TEST_PASSWORD || process.argv[3];

if (!EMAIL || !PASSWORD) {
  console.log('NOT TESTED — the employee handoff needs a real signed-in account.');
  console.log('  Creating the QR code is an authenticated write to the live database.');
  console.log('  Run it as:  SDC_TEST_EMAIL=... SDC_TEST_PASSWORD=... node tools/testing/verify-employee-handoff.mjs');
  process.exit(0);
}

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

const DRAFT_KEY = 'sdc.discipline.draft.v1';

/* A notice with a distinctive phrase in it, so the check that the employee
   is reading HIS document cannot pass on a blank form or somebody else's. */
const MARKER = 'active lightning stand-down';
const DRAFT = {
  employeeName: 'Handoff Test Employee',
  position: 'Operator',
  supervisor: 'A Supervisor',
  jobSite: 'Handoff Test Site',
  noticeDate: '2026-09-15',
  warningLevel: 'written',
  whatOccurred: `Left the designated shelter during an ${MARKER}.`,
  companyPolicyStates: 'Employees remain in the designated shelter until the stand-down is lifted.',
  correctiveActionRequired: 'Remain in the shelter until the stand-down is lifted.',
  managerName: 'Handoff Test - Safety',
  supervisorSignatureData: null,
};

async function drawOn(page, canvas) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(
      box.x + box.width * (0.2 + i * 0.05),
      box.y + box.height * (0.5 + Math.sin(i) * 0.18),
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  const done = page.getByRole('button', { name: /^(Done|Save)$/ }).first();
  if (await done.count()) { await done.click().catch(() => {}); await page.waitForTimeout(400); }
  return true;
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let token = null;
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    // ── Management ──────────────────────────────────────────────────────
    const office = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    await office.addInitScript(([key, draft]) => {
      localStorage.setItem(key, draft);
    }, [DRAFT_KEY, JSON.stringify(DRAFT)]);
    const mgr = await office.newPage();
    const mgrErrors = [];
    mgr.on('pageerror', e => mgrErrors.push(String(e)));

    await mgr.goto(BASE, { waitUntil: 'networkidle' });

    // Sign in. The handoff is the one thing in a document workflow that
    // needs an account, so this is not optional setup.
    await mgr.getByRole('button', { name: /Sign in/i }).first().click().catch(() => {});
    await mgr.waitForTimeout(800);
    await mgr.locator('input[type="email"]').first().fill(EMAIL).catch(() => {});
    await mgr.locator('input[type="password"]').first().fill(PASSWORD).catch(() => {});
    await mgr.getByRole('button', { name: /^Sign in$/i }).last().click().catch(() => {});
    await mgr.waitForTimeout(4000);

    // Into the disciplinary, on to Signatures.
    await mgr.getByRole('button', { name: 'Documents', exact: false }).first().click();
    await mgr.waitForTimeout(600);
    const row = mgr.locator('.listItem', { hasText: 'Employee Disciplinary Notice' });
    await row.getByRole('button', { name: /Start|Continue|Resume/ }).first().click();
    await mgr.waitForTimeout(900);
    await mgr.getByRole('button', { name: /Signatures/ }).first().click().catch(() => {});
    await mgr.waitForTimeout(900);

    const panel = mgr.locator('.empPanel');
    check('the handoff is offered on the signatures step', (await panel.count()) > 0);

    await mgr.getByRole('button', { name: /Show the code/i }).first().click().catch(() => {});
    await mgr.waitForSelector('.empLink', { timeout: 20000 }).catch(() => {});
    const link = await mgr.locator('.empLink').first().innerText().catch(() => '');
    token = (/#\/me\/([A-Za-z0-9_-]+)/.exec(link) || [])[1] || null;
    check('clicking it produces a real code', Boolean(token), token ? '' : `no link rendered (${link || 'empty'})`);
    if (!token) { await browser.close(); return; }

    await mgr.locator('.empPanel').screenshot({ path: path.join(outDir, 'management-qr.png') }).catch(() => {});

    // ── The employee: another browser, no account, no session ───────────
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const emp = await phone.newPage();
    const empErrors = [];
    emp.on('pageerror', e => empErrors.push(String(e)));

    await emp.goto(`${BASE}#/me/${token}`, { waitUntil: 'networkidle' });
    await emp.waitForTimeout(2500);

    check('the employee sees the actual notice, not a summary',
      (await emp.locator('.docFacsimile').count()) > 0);
    const readsBack = await emp.locator('.docFacsimile').innerText().catch(() => '');
    check('and it is HIS notice', readsBack.toLowerCase().includes(MARKER),
      readsBack.replace(/\s+/g, ' ').slice(0, 100));
    check('the builder never loads on his phone',
      !(await emp.locator('.stepNav, .builderHeader').count()));
    await emp.screenshot({ path: path.join(outDir, 'employee-phone.png'), fullPage: true }).catch(() => {});

    await emp.locator('.empTextarea').fill(
      'I went to my truck for a rain jacket. I did not know that counted as leaving the shelter.',
    ).catch(() => {});

    const canvas = emp.locator('canvas').first();
    if (await canvas.count()) await drawOn(emp, canvas);
    check('he can sign on his own phone',
      (await emp.locator('.signaturePreview, .signaturePad img').count()) > 0);

    await emp.getByRole('button', { name: /Send it back/i }).first().click();
    await emp.waitForTimeout(3000);
    const doneTitle = await emp.locator('.empTitle').first().innerText().catch(() => '');
    check('sending it back works', /^Sent/i.test(doneTitle), doneTitle);

    // ── It lands back on the notice, without a refresh ───────────────────
    // The panel polls every four seconds; give it two rounds.
    await mgr.waitForTimeout(10000);
    const landed = await mgr.locator('.empPanelDone').count();
    check('it appears on the notice on its own, no refresh', landed > 0);
    const stored = await mgr.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), DRAFT_KEY);
    check('his statement is in section 4',
      /rain jacket/i.test(stored.employeeStatement || ''), stored.employeeStatement || '(empty)');
    check('his signature is on the notice',
      typeof stored.employeeSignatureData === 'string' && stored.employeeSignatureData.startsWith('data:image'));
    await mgr.screenshot({ path: path.join(outDir, 'management-received.png') }).catch(() => {});

    // ── The link is spent ───────────────────────────────────────────────
    await emp.goto(`${BASE}#/me/${token}`, { waitUntil: 'domcontentloaded' });
    await emp.reload({ waitUntil: 'networkidle' });
    await emp.waitForTimeout(2500);
    check('the same link cannot be used twice',
      /no longer open/i.test(await emp.locator('.empTitle').first().innerText().catch(() => '')));

    // ── A made-up link shows nothing ────────────────────────────────────
    await emp.goto(`${BASE}#/me/${'Zx9'.repeat(14)}`, { waitUntil: 'domcontentloaded' });
    await emp.reload({ waitUntil: 'networkidle' });
    await emp.waitForTimeout(2500);
    check('an invented link shows nothing at all',
      (await emp.locator('.docFacsimile').count()) === 0);

    check('no crashes on either side', mgrErrors.length === 0 && empErrors.length === 0,
      [...mgrErrors, ...empErrors].slice(0, 2).join(' | '));

    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED`);
    if (token) {
      console.log('\nThe test row expires on its own in two hours. To remove it now:');
      console.log(`  delete from public.employee_requests where token = '${token}';`);
    }
    process.exit(results.some(r => !r.pass) ? 1 : 0);
  }
}

main().catch(err => { console.error('handoff check crashed:', err); process.exit(1); });
