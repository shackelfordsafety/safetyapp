// Photograph Records with a realistic number of filed documents, without
// signing in to the real database.
//
//   node tools/testing/capture-records-recent.mjs > out.log 2>&1
//
// Every call to Supabase is answered here: a fake session, a fake HR
// profile, and a dozen fake documents. Anything else bound for the real
// project is aborted, so this can never read or write a real record.
//
// Checks the rule Fonzo set on 2026-09-26: opening Records shows the five
// most recent, and searching still finds every match.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const outDir = path.join(HERE, 'output', 'records-recent');
const PORT = 4401;
const BASE = `http://localhost:${PORT}/`;
const REF = 'adqhuueugwbbudekpkiw';

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'hr@example.com', aud: 'authenticated', role: 'authenticated' };

// Twelve documents, newest first, the way the real query returns them.
const DOCS = Array.from({ length: 12 }, (_, i) => {
  const day = 26 - i;
  const sep = i === 7;
  return {
    id: `doc-${i}`,
    doc_type: sep ? 'separation' : 'jsa',
    employee_name: sep ? 'Test Employee' : null,
    job_site: sep ? 'Entergy TAPS' : null,
    doc_date: `2026-09-${String(day).padStart(2, '0')}`,
    submitted_at: `2026-09-${String(day).padStart(2, '0')}T11:${String(10 + i).padStart(2, '0')}:00Z`,
    submitted_by: USER.id,
    pdf_path: `x/${i}.pdf`,
    jobNumber: sep ? null : (i % 2 ? '480-20' : '480-02'),
    source: null,
  };
});

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 5000));
  const browser = await chromium.launch();
  try {
    for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1180, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport, hasTouch: label === 'phone' });
      await ctx.addInitScript(([ref, user]) => {
        localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
          access_token: 'fake', refresh_token: 'fake', token_type: 'bearer',
          expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400, user,
        }));
      }, [REF, USER]);

      const aborted = [];
      await ctx.route(`https://${REF}.supabase.co/**`, async route => {
        const req = route.request();
        const url = req.url();
        const wantsObject = (req.headers().accept || '').includes('vnd.pgrst.object');
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.includes('/auth/v1/user')) return json(USER);
        if (url.includes('/rest/v1/profiles') && url.includes('id=eq.')) {
          const me = { full_name: 'Test HR', role: 'hr' };
          return json(wantsObject ? me : [me]);
        }
        if (url.includes('/rest/v1/profiles')) return json([{ id: USER.id, full_name: 'Test HR' }]);
        if (url.includes('/rest/v1/documents') && req.method() === 'GET') return json(DOCS);
        aborted.push(`${req.method()} ${url.split('?')[0]}`);
        return route.abort();
      });

      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /^Records$/ }).first().click();
      await page.waitForSelector('.arcTable', { timeout: 10000 });
      await page.waitForTimeout(600);

      const home = await page.locator('.arcTable tbody tr').count();
      check(`${label}: opening Records shows 5`, home === 5, `${home} rows`);
      const hint = await page.getByText(/Showing the 5 most recent/).count();
      check(`${label}: says how to find older ones`, hint === 1);
      await page.screenshot({ path: path.join(outDir, `${label}-1-open.png`), fullPage: true });

      await page.getByPlaceholder('Search an employee or job site').fill('480');
      await page.waitForTimeout(500);
      const found = await page.locator('.arcTable tbody tr').count();
      const expected = DOCS.filter(d => (d.jobNumber || '').includes('480')).length;
      check(`${label}: search finds every match, not just 5`, found === expected, `${found} of ${expected}`);
      await page.screenshot({ path: path.join(outDir, `${label}-2-search.png`), fullPage: true });

      await page.getByRole('button', { name: /All documents/ }).click();
      await page.locator('.arcShelf', { hasText: 'JSA' }).click();
      await page.waitForTimeout(500);
      const shelf = await page.locator('.arcTable tbody tr').count();
      const jsas = DOCS.filter(d => d.doc_type === 'jsa').length;
      check(`${label}: tapping a type shows all of that type`, shelf === jsas, `${shelf} of ${jsas}`);

      if (aborted.length) console.log(`  blocked: ${[...new Set(aborted)].join(', ')}`);
      await ctx.close();
    }
  } catch (err) {
    console.error('!! FAILED: ' + (err?.message || err));
    results.push({ pass: false });
  } finally {
    await browser.close().catch(() => {});
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    console.log(`screens in ${outDir}`);
    process.exit(failed ? 1 : 0);
  }
}

main();
