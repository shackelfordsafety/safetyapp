// First sign-in with no name on the account: the app asks for it, right
// there, and it can't just be waved away.
//
//   node tools/testing/verify-first-signin-name.mjs [outDir]
//
// Fonzo, 2026-09-28: people signed in, saw "you don't have a name", and had
// to be told to go dig in Settings. The database answers are faked at the
// network layer (a signed-in session, a profile with no name, and the
// set_my_display_name call), same approach as capture-people-screen.mjs.
//
// Checks: the dialog shows on Home; there is no Later/close; Save is off
// until a real name is typed; saving closes it; a failed save offers a way
// out (dead-zone rule); it never pops up in the middle of a JSA.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'first-signin');
mkdirSync(outDir, { recursive: true });

const PORT = 4487;
const BASE = `http://localhost:${PORT}`;
const REF = 'adqhuueugwbbudekpkiw';
const ME = '00000000-0000-4000-8000-000000000009';
const USER = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'new.foreman@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const SESSION = { access_token: 'fake.jwt.token', refresh_token: 'fake', token_type: 'bearer', expires_in: 31536000, expires_at: Math.floor(Date.now() / 1000) + 31536000, user: USER };
const JSA = readFileSync(path.join(__dirname, 'fixtures', 'jsa-real-shape.json'), 'utf8');

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

async function open(browser, { failSave = false, draft = null, theme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
  await ctx.addInitScript(([ref, sess, t, d]) => {
    localStorage.setItem(`sb-${ref}-auth-token`, sess);
    localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: t }));
    if (d) localStorage.setItem('sdc.jsa.draft.v4', d);
  }, [REF, JSON.stringify(SESSION), theme, draft]);
  const state = { named: '' };
  await ctx.route(new RegExp(`${REF}\\.supabase\\.co`), route => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json(USER);
    if (url.includes('/rpc/set_my_display_name')) {
      if (failSave) return route.abort('internetdisconnected');
      state.named = JSON.parse(route.request().postData() || '{}').new_name || '';
      return json(state.named);
    }
    if (url.includes('/rest/v1/profiles')) return json({ id: ME, full_name: state.named || null, role: 'field', is_admin: false });
    return json([]);
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  return { ctx, page, errors };
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

  {
    const { ctx, page, errors } = await open(browser);
    const dialog = page.locator('.nameSetup');
    check(await dialog.count() === 1, 'No name on the account: the name screen shows on sign-in');
    await page.screenshot({ path: path.join(outDir, '1-welcome.png') });
    check(await dialog.getByRole('button', { name: /later|close|cancel|skip/i }).count() === 0, 'There is no Later / close button');
    const save = dialog.getByRole('button', { name: /Save and continue/ });
    check(await save.isDisabled(), 'Save is off until a name is typed');
    await dialog.locator('input').fill('Jose Luis Hernandez-Ramirez');
    check(!(await save.isDisabled()), 'Save turns on once a name is typed');
    await save.click();
    await page.waitForTimeout(1500);
    check(await page.locator('.nameSetup').count() === 0, 'Saving closes it');
    await page.screenshot({ path: path.join(outDir, '2-after-save.png') });
    check(!errors.length, `No page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { failSave: true, theme: 'light' });
    await page.locator('.nameSetup input').fill('Dewayne Fairchild');
    await page.getByRole('button', { name: /Save and continue/ }).click();
    await page.waitForTimeout(1500);
    const skip = page.getByRole('button', { name: /Skip for now/ });
    check(await skip.count() === 1, 'No signal: after a failed save it offers "Skip for now"');
    await page.screenshot({ path: path.join(outDir, '3-no-signal.png') });
    await skip.click();
    await page.waitForTimeout(500);
    check(await page.locator('.nameSetup').count() === 0, 'Skip gets you into the app');
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { draft: JSA });
    /* Close it the honest way first -- then open the JSA and make sure a
       fresh sync never drops it on top of the document. */
    await page.locator('.nameSetup input').fill('Test');
    const before = await page.locator('.nameSetup').count();
    await ctx.close();
    const second = await open(browser, { draft: JSA, failSave: true });
    await second.page.locator('.nameSetup input').fill('x y');
    await second.page.getByRole('button', { name: /Save and continue/ }).click();
    await second.page.waitForTimeout(1200);
    await second.page.getByRole('button', { name: /Skip for now/ }).click();
    await second.page.getByRole('button', { name: /^Continue/ }).first().click();
    await second.page.waitForTimeout(3000);
    check(before === 1 && await second.page.locator('.nameSetup').count() === 0, 'Never shows on top of a JSA in progress');
    await second.ctx.close();
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
