/* The "view as" picker names roles, never people.

   It said "Hunter or Reeves", "Pat", "Nic" until 2026-09-11. Fonzo:
   "hunter and reeves dont need to be named, no one needs to be named".
   A settings screen gets read over somebody's shoulder, and a name goes
   stale the day that person changes job. */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 4361;
const BASE_URL = `http://localhost:${PORT}`;

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error('server never came up'));
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    /* The picker only renders for a signed-in admin, so read the strings
       out of the BUILT bundle -- that is what actually ships, and it does
       not need somebody logged in to be true. */
    const { readFileSync, readdirSync } = await import('node:fs');
    const assets = path.join(repoRoot, 'dist', 'assets');
    const bundle = readdirSync(assets)
      .filter(f => f.endsWith('.js'))
      .map(f => readFileSync(path.join(assets, f), 'utf8'))
      .join('\n');

    const names = ['Hunter', 'Reeves', 'Pat —', 'Nic —'];
    const found = names.filter(n => bundle.includes(n));
    check('no person is named in what ships', found.length === 0, found.join(', '));

    const labels = ['See as an owner', 'See as HR', 'See as a PM', 'See as safety',
      'See as a clerk', 'See as a superintendent', 'See as a foreman', 'See as a field employee'];
    const missing = labels.filter(l => !bundle.includes(l));
    check('every role reads "See as ..."', missing.length === 0, missing.join(', '));

    check('"Myself" is still the way back', bundle.includes('Myself'));
    await browser.close();
  } finally {
    killTree(server);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
