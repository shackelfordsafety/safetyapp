// A document waiting for sign-off opens VIEW ONLY for anybody who can't
// sign it off -- and does not touch what is on their iPad.
//
//   node tools/testing/verify-submitted-is-view-only.mjs [outDir]
//
// Fonzo, 2026-09-28: opening something you had submitted made a brand new
// editable draft that looked like the submitted one; people thought they
// were editing what they sent.
//
// The review queue lives in the cloud, so the one lazily-loaded module the
// list reads from (openDocs) is stubbed at the network layer, same as
// capture-waiting-on-you.mjs. Everything else is the real app.
//
// Checks, for a superintendent who submitted it:
//   - tapping it shows the view-only viewer, with the document on it
//   - pickUpOpenDocument (the thing that writes a draft) is NOT called
//   - the draft already on the device is byte-for-byte unchanged
// and for HR (who signs disciplinaries off): the old open-to-edit path.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'view-only');
mkdirSync(outDir, { recursive: true });

const PORT = 4477;
const BASE = `http://localhost:${PORT}`;
const fx = n => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const DISC = fx('disciplinary-normal.json');
const INC = fx('incident-full-fixture.json');
const LOCAL_DRAFT = JSON.stringify({ ...fx('disciplinary-stress-messy.json'), employeeName: 'SOMEONE ELSE I WAS WORKING ON' });

const ROWS = [
  { id: 'd1', doc_type: 'disciplinary', state: 'submitted', created_by: 'me', employee_name: DISC.employeeName, createdByName: 'Kris Taute', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'i1', doc_type: 'incident', state: 'submitted', created_by: 'me', employee_name: INC.injuredPartyName, job_site: INC.workplaceLocation, createdByName: 'Kris Taute', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];
const DATA = { d1: DISC, i1: INC };

function stub(role) {
  return `
    export async function whoAmI() { return { id: 'me', full_name: 'Test Person', role: ${JSON.stringify(role)}, is_admin: false }; }
    export async function listOpenDocuments() { return ${JSON.stringify(ROWS)}; }
    export async function myUnacknowledgedChanges() { return []; }
    export async function getOpenDocument(id) { const rows = ${JSON.stringify(ROWS)}; const data = ${JSON.stringify(DATA)}; return { ...rows.find(r => r.id === id), data: data[id] }; }
    export async function pickUpOpenDocument(id) { window.__pickedUp = (window.__pickedUp || []).concat(id); throw new Error('stub: would have opened for editing'); }
    export async function peopleToHandTo() { return []; }
  `;
}

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
const check = (ok, msg) => { results.push({ ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

  for (const [role, theme] of [['superintendent', 'dark'], ['hr', 'light']]) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
    await ctx.route(/\/assets\/openDocs-.*\.js$/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: stub(role) }));
    await ctx.addInitScript(([d, t]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('sdc.discipline.draft.v1', d);
        sessionStorage.setItem('seeded', '1');
      }
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: t }));
    }, [LOCAL_DRAFT, theme]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => (role === 'hr' ? d.accept() : d.dismiss()));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /My Work/ }).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `${role}-0-list.png`), fullPage: true });

    await page.locator('.odRowMain', { hasText: 'Disciplinary' }).first().click();
    await page.waitForTimeout(1500);
    const viewer = await page.locator('.vodOverlay').count();
    const picked = await page.evaluate(() => window.__pickedUp || []);
    const draftAfter = await page.evaluate(() => localStorage.getItem('sdc.discipline.draft.v1'));

    if (role === 'superintendent') {
      await page.screenshot({ path: path.join(outDir, `${role}-1-disciplinary.png`) });
      check(viewer === 1, 'Submitter: disciplinary opens in the view-only viewer');
      check(picked.length === 0, 'Submitter: nothing was opened for editing');
      check(draftAfter === LOCAL_DRAFT, 'Submitter: the draft already on this iPad is untouched');
      const hasInputs = await page.locator('.vodOverlay input, .vodOverlay textarea').count();
      check(hasInputs === 0, 'Submitter: no editable boxes in the viewer');
      await page.getByRole('button', { name: 'Close' }).click();
      await page.waitForTimeout(400);
      await page.locator('.odRowMain', { hasText: 'Incident' }).first().click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(outDir, `${role}-2-incident.png`) });
      const incPages = await page.locator('.vodOverlay .incidentPage').count();
      check(incPages >= 5, `Submitter: incident shows its real pages (${incPages})`);
    } else {
      check(viewer === 0 && picked.includes('d1'), 'HR (the approver): disciplinary still opens for editing, as before');
    }
    check(errors.length === 0, `${role}: no page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
  results.push({ ok: false });
} finally {
  console.log(results.every(r => r.ok) ? '\nALL PASS' : '\nSOMETHING FAILED');
  killTree(server);
  process.exit(0);
}
