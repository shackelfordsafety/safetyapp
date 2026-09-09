// Settings must still be a purely local screen for anyone not signed in.
//
// The Profile card talks to the database, so the risk of adding it is that
// Settings quietly starts requiring an account, or drags cloud code into a
// screen a superintendent opens with no signal. This checks the
// signed-out path only -- the signed-in card needs a real password, which
// this harness has no business holding.
//
// Usage: node tools/testing/verify-settings-profile.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'settings');
mkdirSync(outDir, { recursive: true });

const PORT = 4329;
const BASE_URL = `http://localhost:${PORT}`;

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
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const requests = [];
    page.on('request', r => requests.push(r.url()));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, 'settings-signedout.png'), fullPage: true });

    const body = await page.locator('body').innerText();
    const hasProfile = body.includes('Your Profile');
    const hasNudge = body.includes('Add your name');
    const hasAppearance = body.includes('Appearance');
    const supabaseCalls = requests.filter(u => u.includes('supabase.co'));

    console.log('Settings renders (Appearance present):', hasAppearance);
    console.log('Profile card hidden while signed out:', !hasProfile);
    console.log('Name nudge hidden while signed out:  ', !hasNudge);
    console.log('Calls to Supabase while signed out:  ', supabaseCalls.length);
    console.log('Page errors:', errors.length ? errors : 'none');

    const ok = hasAppearance && !hasProfile && !hasNudge && supabaseCalls.length === 0 && errors.length === 0;
    console.log(ok ? '\nPASS  Settings is still local-only when signed out.' : '\nFAIL');
    await browser.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
