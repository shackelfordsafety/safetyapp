// What HR actually sees, screen by screen.
//
//   node tools/testing/capture-hr-journey.mjs [outDir]
//
// Fonzo asked for a walkthrough of Pat's side of a separation. Rather than
// describe it, this renders it: the real app, as a signed-in HR user, with
// a real separation sitting in her queue.
//
// She is stubbed at the network layer -- the one lazily-loaded module the
// worklist reads from returns her profile and one waiting document. The
// screens, the wording and the buttons are all the real thing. Nothing
// touches the company's database and no account is created.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'hr-journey');
mkdirSync(outDir, { recursive: true });

const PORT = 4448;
const BASE = `http://localhost:${PORT}`;

const HOURS_AGO = h => new Date(Date.now() - h * 3600 * 1000).toISOString();

/* One separation, submitted by the man who ran the meeting, waiting on
   her. Shaped exactly like a row from listOpenDocuments(). */
const WAITING = [{
  id: 'sep-1',
  doc_type: 'separation',
  state: 'submitted',
  employee_name: 'Derrick Wilson',
  job_site: 'Entergy TAPS',
  doc_date: '2026-09-14',
  created_by: 'fonzo',
  createdByName: 'Alfonso Hernandez',
  submitted_by: 'fonzo',
  submittedByName: 'Alfonso Hernandez',
  submitted_at: HOURS_AGO(2),
  updated_at: HOURS_AGO(2),
}];

const STUB = `
  export async function whoAmI() {
    return { id: 'pat', full_name: 'Pat Foster', role: 'hr', is_admin: false };
  }
  export async function listOpenDocuments() { return ${JSON.stringify(WAITING)}; }
  export async function myUnacknowledgedChanges() { return []; }
  export async function peopleToHandTo() { return []; }
`;

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
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem('sb-test-auth-token', JSON.stringify({
        user: { email: 'pat@shackelfordconst.com', id: 'pat' },
      }));
    });
    await context.route(/\/assets\/openDocs-.*\.js$/, r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB,
    }));

    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    await page.screenshot({ path: path.join(outDir, '1-home.png'), fullPage: true });
    const waitingRows = await page.locator('.waitingRow').allInnerTexts();
    console.log('HOME — waiting rows:');
    waitingRows.forEach(r => console.log(`   ${JSON.stringify(r.replace(/\n/g, ' | '))}`));

    /* By class, not by accessible name: the nav item carries a count
       badge, so its name is 'My Work 1' once anything is waiting -- which
       is exactly the state this capture exists to show. */
    await page.locator('.sidebarNavItem', { hasText: 'My Work' }).first().click().catch(() => {});
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(outDir, '2-my-work.png'), fullPage: true });

    const row = await page.locator('.odRow').first().innerText().catch(() => '');
    console.log('MY WORK — the row reads:');
    row.split(/\r?\n/).filter(Boolean).forEach(l => console.log(`   ${JSON.stringify(l.trim())}`));

    const actions = await page.locator('.odRowActions button').allInnerTexts().catch(() => []);
    console.log('MY WORK — her buttons:', JSON.stringify(actions.map(a => a.trim())));

    await browser.close();
    console.log('\nsaved to', outDir);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('hr journey capture crashed:', err); process.exit(1); });
