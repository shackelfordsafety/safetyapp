// A JSA put up early can't be signed early.
//
//   node tools/testing/verify-jsa-signing-window.mjs [outDir]
//
// Fonzo, 2026-09-28: publishing the night before left the JSA signable all
// night ("expires in 33 hours"). Signing now opens 30 minutes before Time
// Issued, and the board says so: Scheduled / Starts soon / Live / Closed.
//
// Four postings, built relative to NOW so this passes at any hour:
//   scheduled - starts in 10 hours      -> readable, NO sign button
//   upcoming  - starts in 20 minutes    -> signable, "Starts soon"
//   open      - started an hour ago     -> signable, "Live"
//   closed    - ended an hour ago       -> not signable
//
// The database is answered locally (board_for, and for the super's board a
// signed-in session + jsa_publications), same approach as
// capture-people-screen.mjs. The DB-side refusal is the migration's job and
// is checked separately against the real database.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'signing-window');
mkdirSync(outDir, { recursive: true });

const PORT = 4485;
const BASE = `http://localhost:${PORT}`;
const REF = 'adqhuueugwbbudekpkiw';
const OWNER = '00000000-0000-4000-8000-000000000001';

const pad = n => String(n).padStart(2, '0');
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/* A posting whose shift starts `startMin` minutes from now and runs 8h. */
function posting(id, label, startMin) {
  const start = new Date(Date.now() + startMin * 60000);
  const end = new Date(start.getTime() + 8 * 3600000);
  return {
    id, area_label: label, job_site: 'Entergy TAPS', location: 'Ridgeland, MS', job_number: '480-02',
    doc_date: localDay(start), published_at: new Date(Date.now() - 3600000).toISOString(),
    expires_at: end.toISOString(), version: 1, pdf_path: null, client_doc_id: id,
    data: {
      date: localDay(start), timeIssued: hm(start), timeExpired: hm(end), jobSite: 'Entergy TAPS',
      overallWorkTask: label, taskRows: [{ step: 'Mass grading', hazards: 'Struck by equipment', controls: 'Spotter' }],
    },
  };
}
const ROWS = [
  posting('00000000-0000-4000-8000-00000000000a', 'Tomorrow — North haul road', 600),
  posting('00000000-0000-4000-8000-00000000000b', 'Starting soon — Lime station', 20),
  posting('00000000-0000-4000-8000-00000000000c', 'Running now — East gen pad', -60),
  posting('00000000-0000-4000-8000-00000000000d', 'Finished — Laydown yard', -9 * 60),
];

const USER = { id: OWNER, aud: 'authenticated', role: 'authenticated', email: 'super@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const SESSION = { access_token: 'fake.jwt.token', refresh_token: 'fake', token_type: 'bearer', expires_in: 31536000, expires_at: Math.floor(Date.now() / 1000) + 31536000, user: USER };

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

  // ── The crew's phone ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await ctx.route(new RegExp(`${REF}\\.supabase\\.co`), route => {
      const url = route.request().url();
      if (url.includes('/rpc/board_for')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE}#/sign/${OWNER}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, 'crew-1-list.png'), fullPage: true });
    const tag = async label => (await page.locator('.crewPick', { hasText: label }).locator('.crewTag').innerText()).trim();
    check(/scheduled/i.test(await tag('Tomorrow')), `Crew list: tomorrow's JSA is tagged "${await tag('Tomorrow')}"`);
    check(/starts soon/i.test(await tag('Starting soon')), `Crew list: 20-min-out JSA is tagged "${await tag('Starting soon')}"`);
    check(/live/i.test(await tag('Running now')), `Crew list: running JSA is tagged "${await tag('Running now')}"`);
    check(/closed/i.test(await tag('Finished')), `Crew list: finished JSA is tagged "${await tag('Finished')}"`);

    for (const [label, shouldSign, shot] of [['Tomorrow', false, 'crew-2-scheduled'], ['Starting soon', true, 'crew-3-soon'], ['Running now', true, 'crew-4-live']]) {
      await page.locator('.crewPick', { hasText: label }).click();
      await page.waitForTimeout(800);
      const canSign = await page.getByRole('button', { name: 'Sign the JSA' }).count() > 0;
      check(canSign === shouldSign, `Crew: "${label}" ${shouldSign ? 'has' : 'has NO'} Sign button`);
      await page.screenshot({ path: path.join(outDir, `${shot}.png`) });
      await page.getByRole('button', { name: /Back to the list/ }).click();
      await page.waitForTimeout(500);
    }
    check(!errors.length, `Crew page: no page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }

  // ── The superintendent's own Crew Board ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
    await ctx.addInitScript(([ref, sess]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, sess);
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: 'dark' }));
    }, [REF, JSON.stringify(SESSION)]);
    await ctx.route(new RegExp(`${REF}\\.supabase\\.co`), route => {
      const url = route.request().url();
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/auth/v1/user')) return json(USER);
      if (url.includes('/rest/v1/jsa_publications')) return json(ROWS);
      if (url.includes('/rest/v1/profiles')) return json({ id: OWNER, full_name: 'Test Super', role: 'superintendent', is_admin: false });
      return json([]);
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Crew Board/ }).first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, 'board-1.png'), fullPage: true });
    const card = label => page.locator('.brdCard', { hasText: label });
    check(await card('Tomorrow').locator('.brdState--scheduled').count() === 1, 'Board: tomorrow\'s JSA shows Scheduled');
    check(/Signing opens/.test(await card('Tomorrow').locator('.brdMeta').innerText()), `Board: says when signing opens — "${await card('Tomorrow').locator('.brdMeta').innerText()}"`);
    check(await card('Tomorrow').getByRole('button', { name: 'Sign on this device' }).count() === 0, 'Board: no "Sign on this device" on a scheduled JSA');
    check(await card('Running now').getByRole('button', { name: 'Sign on this device' }).count() === 1, 'Board: "Sign on this device" is there on a live JSA');
    check(!errors.length, `Board: no page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
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
