// The testing site must not be able to write anything real.
//
// It runs the same code against the same database as the live site, so
// before the owners are sat in front of it and told to mess around, this
// has to be proven rather than assumed. A JSA published from there would
// appear on a board a real crew scans; a filed document would land in an
// archive that by design cannot delete.
//
// Checks three things: the banner is there and cannot be dismissed, the
// real app is completely unaffected, and -- the part that matters -- an
// actual publish attempt is refused before it reaches the network.
//
// Usage: node tools/testing/verify-demo-mode.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'demomode');
mkdirSync(outDir, { recursive: true });

const PORT = 4347;
const BASE = `http://localhost:${PORT}/`;
const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-medical-address.json'), 'utf8');

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
  let ok = true;
  try {
    await waitForServer(BASE, 20000);
    const browser = await chromium.launch();

    // ── The real app: no banner, nothing changed ──
    {
      const c = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      const p = await c.newPage();
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForTimeout(900);
      const banner = await p.locator('.demoBanner').count();
      const title = await p.title();
      console.log('[real site]');
      console.log(`   banner shown:  ${banner > 0}`);
      console.log(`   tab title:     ${title}`);
      if (banner !== 0 || /TESTING/.test(title)) ok = false;
      await c.close();
    }

    // ── The testing site (?demo=1 stands in for the preview host) ──
    const c = await browser.newContext({ viewport: { width: 1200, height: 950 } });
    await c.addInitScript((json) => {
      window.localStorage.setItem('sdc.jsa.draft.v4', json);
    }, draftJson);
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));

    // Every request that leaves the page, so a write that slipped through
    // would be visible rather than assumed absent.
    const writes = [];
    p.on('request', (r) => {
      if (!/supabase\.co/.test(r.url())) return;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) {
        writes.push(`${r.method()} ${r.url().split('/').slice(3).join('/').slice(0, 70)}`);
      }
    });

    await p.goto(`${BASE}?demo=1`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);

    const banner = await p.locator('.demoBanner').count();
    const dismiss = await p.locator('.demoBanner button').count();
    const title = await p.title();
    console.log('\n[testing site]');
    console.log(`   banner shown:      ${banner > 0}`);
    console.log(`   dismissable:       ${dismiss > 0}`);
    console.log(`   tab title:         ${title}`);
    if (banner === 0 || dismiss > 0 || !/^TESTING/.test(title)) ok = false;

    await p.screenshot({ path: path.join(outDir, 'app.png'), fullPage: false });

    // ── Actually try to publish ──
    await p.getByRole('button', { name: 'Continue JSA' }).click();
    await p.waitForTimeout(500);
    await p.getByRole('tab').last().click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: /On their phones/ }).first().click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: /Publish to my board/ }).first().click();
    await p.waitForTimeout(2500);

    const body = await p.locator('body').innerText();
    const refused = /testing site/i.test(body);
    console.log(`   publish refused:   ${refused}`);
    console.log(`   writes that reached the network: ${writes.length ? writes.join(', ') : 'none'}`);
    if (!refused || writes.length > 0) ok = false;

    await p.screenshot({ path: path.join(outDir, 'publish-refused.png'), fullPage: false });

    /* The demo has to still be a real demo. Everything that stays on the
       device must work completely -- an owner should be able to build a
       JSA and generate the actual PDF, because judging the document is the
       point of showing it to him. So this drives the paper route and waits
       for a real generated PDF, rather than grepping for a button. */
    await p.getByRole('button', { name: /On paper/ }).first().click();
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: /Make the printout|Create Document/ }).first().click();
    const ready = await p.locator('.pdfReadyPanel')
      .waitFor({ state: 'visible', timeout: 60000 })
      .then(() => true).catch(() => false);
    console.log(`   real PDF still generates:      ${ready}`);
    if (!ready) ok = false;
    await p.screenshot({ path: path.join(outDir, 'pdf-still-works.png'), fullPage: false });

    console.log('\nPage errors:', errors.length ? errors : 'none');
    if (errors.length) ok = false;

    console.log(ok ? '\nPASS  nothing real can leave the testing site.' : '\nFAIL');
    await browser.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
