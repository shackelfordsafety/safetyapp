// Settings > People as HR sees it, with a whole company in it.
//
//   node tools/testing/capture-people-screen.mjs [outDir]
//
// Fonzo, 2026-09-28: "on pat's log in, or HR view, the people screen is
// HUUUUUGE". The list lives in the cloud behind a real login, so this fakes
// ONE thing -- the database's answers, at the network layer (a signed-in
// session in storage, and replies to the few tables the screen reads). The
// supabase client, the screen and everything else run for real.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'people');
mkdirSync(outDir, { recursive: true });

const PORT = 4481;
const BASE = `http://localhost:${PORT}`;
const REF = 'adqhuueugwbbudekpkiw';
const ME = '00000000-0000-4000-8000-000000000001';

const NAMES = [
  ['Pat Halloway', 'hr'], ['Kris Taute', 'superintendent'], ['Jake Lytle', 'foreman'], ['Gaines Newell', 'superintendent'],
  ['Nic Mann', 'pm'], ['Devin Ray', 'field'], ['Roberto Salinas Jr.', 'field'], ['Dewayne Fairchild', 'foreman'],
  ['Marcus Doyle', 'field'], [null, 'field'], ['Tammy Oakes', 'clerk'], ['Owner Person', 'owner'],
  ['Luis Hernandez-Ramirez', 'field'], ['Ray Ferris', 'superintendent'], ['Dale Hutto', 'field'], ['Brandon K. Whitfield III', 'pm'],
  ['Cody Pruitt', 'foreman'], ['Safety Desk', 'safety'], ['Josh Adkins', 'field'], ['Terrence Bell', 'field'],
];
const PEOPLE = NAMES.map(([n, r], i) => ({
  id: i === 0 ? ME : `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
  full_name: n, role: r, is_admin: false,
}));
const CHANGES = [
  { id: 1, target_user: PEOPLE[5].id, old_role: 'foreman', new_role: 'field', changed_by: ME, changed_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 2, target_user: PEOPLE[1].id, old_role: 'field', new_role: 'superintendent', changed_by: ME, changed_at: new Date(Date.now() - 5 * 86400000).toISOString() },
];

const USER = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'pat@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const SESSION = {
  access_token: 'fake.jwt.token', refresh_token: 'fake', token_type: 'bearer',
  expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, user: USER,
};

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
  for (const [name, vp] of [['ipad', { width: 1024, height: 1366 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
    await ctx.addInitScript(([ref, sess]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, sess);
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: 'dark' }));
    }, [REF, JSON.stringify(SESSION)]);
    await ctx.route(new RegExp(`${REF}\\.supabase\\.co`), route => {
      const url = route.request().url();
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/auth/v1/user')) return json(USER);
      if (url.includes('/rest/v1/profiles')) {
        return url.includes(`id=eq.${ME}`) ? json(PEOPLE[0]) : json(PEOPLE);
      }
      if (url.includes('/rest/v1/role_changes')) return json(CHANGES);
      return json([]);
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.waitForTimeout(2000);
    const card = page.locator('.card', { hasText: 'Change what each person can see' }).first();
    if (!(await card.count())) { console.log(`${name}: People card did not render`); await page.screenshot({ path: path.join(outDir, `${name}-settings.png`), fullPage: true }); continue; }
    await card.screenshot({ path: path.join(outDir, `${name}-1-list.png`) });
    const box = await card.boundingBox();
    console.log(`${name}: People card is ${Math.round(box.height)}px tall for ${PEOPLE.length} people`);
    if (name === 'ipad') {
      await card.locator('select').nth(2).selectOption('pm');
      await page.waitForTimeout(300);
      await card.screenshot({ path: path.join(outDir, `${name}-2-changed.png`) });
      await card.locator('.peopleSearch').fill('fore');
      await page.waitForTimeout(300);
      await card.screenshot({ path: path.join(outDir, `${name}-3-search.png`) });
      await card.locator('.peopleSearch').fill('');
      await card.locator('.peopleLegend > summary').first().click();
      await page.waitForTimeout(300);
      await card.screenshot({ path: path.join(outDir, `${name}-4-legend.png`) });
    }
    console.log(`${name}: ${errors.length ? `PAGE ERRORS ${errors.join(' | ')}` : 'no page errors'}`);
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
} finally {
  killTree(server);
  process.exit(0);
}
