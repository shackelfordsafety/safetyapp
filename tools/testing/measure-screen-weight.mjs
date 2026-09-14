// How many megabytes does opening a screen actually cost?
//
//   node tools/testing/measure-screen-weight.mjs
//
// Pat, 2026-09-14, on an office desktop: her screen went black and
// everything stalled for about five seconds after a refresh. It was not her
// machine and not the connection -- Home and My Work were each downloading
// the FULL body of every document filed that day, including every crew
// signature stored inside a JSA, to draw a count and one line of text.
//
// This serves realistically-sized rows (a JSA with 18 crew signatures, a
// separation with two) and counts the bytes the app actually pulls, honouring
// exactly the columns it asks for -- so removing a column from a query shows
// up here as a smaller number instead of a hopeful assumption.
//
// Before the fix: 3.13 MB. After: 0.00 MB.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
const PORT = 4456, BASE = `http://localhost:${PORT}`;
const wait = (u, ms) => { const e = Date.now() + ms; return new Promise((r, j) => { const t = () => fetch(u).then(r).catch(() => Date.now() > e ? j(new Error('x')) : setTimeout(t, 300)); t(); }); };
// A filed JSA the size of a real one: crew signatures inside the record.
const bigSig = 'data:image/png;base64,' + 'A'.repeat(80 * 1024);
const filedRows = [
  { id: 'j1', doc_type: 'jsa', employee_name: null, job_site: 'Entergy TAPS', doc_date: '2026-09-14', submitted_at: new Date().toISOString(), pdf_path: 'x/y.pdf', data: { crewSignatures: Array.from({ length: 18 }, () => ({ dataUrl: bigSig })) } },
  { id: 's1', doc_type: 'separation', employee_name: 'Derrick Wilson', doc_date: '2026-09-14', submitted_at: new Date().toISOString(), pdf_path: 'x/z.pdf', data: { employeeSignatureData: bigSig, supervisorSignatureData: bigSig } },
];
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await wait(BASE, 25000);
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1180, height: 900 } });
  await c.addInitScript(() => {
    localStorage.setItem('sb-adqhuueugwbbudekpkiw-auth-token', JSON.stringify({
      access_token: 'fake', refresh_token: 'fake',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'pat', email: 'pat@shackelfordconst.com' },
    }));
  });
  let bytes = 0;
  await c.route(/supabase\.co\//, async (route) => {
    const url = route.request().url();
    let body = '[]';
    if (/\/auth\/v1\/user/.test(url)) body = JSON.stringify({ id: 'pat', email: 'pat@shackelfordconst.com' });
    else if (/\/rest\/v1\/documents/.test(url)) {
      // Honour exactly the columns the app asked for.
      const cols = decodeURIComponent((/[?&]select=([^&]*)/.exec(url) || [])[1] || '');
      const wantsData = /(^|,)data(,|$)/.test(cols);
      body = JSON.stringify(filedRows.map(r => (wantsData ? r : (({ data, ...rest }) => rest)(r))));
    }
    bytes += Buffer.byteLength(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const page = await c.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('.sidebarNavItem', { hasText: 'My Work' }).first().click().catch(() => {});
  await page.waitForTimeout(4000);
  console.log(`Home + My Work pulled ${(bytes / 1048576).toFixed(2)} MB from the server.`);
  await b.close();
} finally { killTree(server); process.exit(0); }
