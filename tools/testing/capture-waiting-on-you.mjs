// Home, showing what is actually waiting on you — before and after.
//
//   node tools/testing/capture-waiting-on-you.mjs
//
// Home has always been able to say "2 · Waiting on you". It has never been
// able to say WHICH two, or who is waiting. That is the change these shots
// exist to review, and it cannot be reviewed from a description: the whole
// question is whether a man glancing at his iPad in a truck understands
// what is being asked of him.
//
// The review queue lives in the cloud and needs a signed-in account with a
// real role, which a screenshot run has no business creating against the
// company's live database. So this stubs the one lazily-loaded module the
// hook reads from (openDocs) at the network layer and lets EVERYTHING else
// run for real — the real hook, the real filtering, the real Home render.
// Nothing in src/ is touched or mocked.
//
// Output: tools/testing/output/waiting/<state>-<viewport>.png

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'waiting');
mkdirSync(outDir, { recursive: true });

const PORT = 4341;
const BASE_URL = `http://localhost:${PORT}`;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, touch: true, mobile: true },
  { name: 'tabL', width: 1180, height: 820, touch: true },
];

/* Deliberately messy, the way a real Tuesday is: a name with a suffix, a
   job site rather than a person on the JSA, somebody with no name set yet,
   and enough rows to push past the cap so the "more" line gets reviewed
   too. Clean test data has passed review here before while hiding a real
   layout bug. */
const HOURS_AGO = h => new Date(Date.now() - h * 3600 * 1000).toISOString();

const OPEN_ROWS = [
  {
    id: 'r1', doc_type: 'separation', state: 'submitted',
    employee_name: 'Kameron Grover', job_site: null,
    submittedByName: 'Nic Mann', createdByName: 'Nic Mann',
    submitted_at: HOURS_AGO(2), updated_at: HOURS_AGO(2),
  },
  {
    id: 'r2', doc_type: 'incident', state: 'submitted',
    employee_name: 'Roberto Salinas Jr.', job_site: 'Entergy Taps',
    submittedByName: 'Kris Taute', createdByName: 'Kris Taute',
    submitted_at: HOURS_AGO(4), updated_at: HOURS_AGO(4),
  },
  {
    id: 'r3', doc_type: 'disciplinary', state: 'submitted',
    employee_name: null, job_site: 'Coyote Creek Pit — north haul road',
    submittedByName: null, createdByName: null,
    submitted_at: HOURS_AGO(20), updated_at: HOURS_AGO(20),
  },
  {
    id: 'r4', doc_type: 'medicalEvent', state: 'open', assigned_to: 'me',
    employee_name: 'Dewayne Fairchild', job_site: null,
    updatedByName: 'Jake Lytle', createdByName: 'Jake Lytle',
    updated_at: HOURS_AGO(30),
  },
];

const NOTICES = [
  { id: 'e1', doc_type: 'incident', editedByName: 'Pat Halloway', edited_at: HOURS_AGO(1) },
];

function stubModule(rows, notices) {
  return `
    export async function whoAmI() {
      return { id: 'me', full_name: 'Alfonso Hernandez', role: 'hr', is_admin: false };
    }
    export async function listOpenDocuments() { return ${JSON.stringify(rows)}; }
    export async function myUnacknowledgedChanges() { return ${JSON.stringify(notices)}; }
  `;
}

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

async function shoot(browser, vp, state, rows, notices, dark, asBefore) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...(vp.touch ? { hasTouch: true, isMobile: Boolean(vp.mobile) } : {}),
  });

  /* The built chunk keeps its hashed name; matching on the stem is what
     survives a rebuild. */
  await context.route(/\/assets\/openDocs-.*\.js$/, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: stubModule(rows, notices),
  }));

  /* Dark is not a preference here, it is the screen a man uses at 5am in
     a truck before the sun is up. A tint that works on white and
     disappears on navy is a fix that only half shipped. */
  if (dark) {
    await context.addInitScript(() => {
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: 'dark' }));
    });
  }

  /* The honest before/after: the SAME five things waiting, rendered by
     the screen as it was. Home could already count them -- the list is
     the only thing that is new -- so hiding just the list shows exactly
     what yesterday's build put in front of you, rather than comparing a
     busy morning against an empty one. */
  if (asBefore) {
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.createElement('style');
        el.textContent = '.waitingList{display:none!important}';
        document.head.appendChild(el);
      });
    });
  }

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  /* The hook loads its module after first paint; without this the shot is
     of the screen a quarter-second before the answer arrives. */
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `${state}-${vp.name}.png`), fullPage: true });

  const seen = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.waitingRow')].map(el => el.innerText.replace(/\n+/g, ' | ')),
    more: document.querySelector('.waitingMore')?.innerText || null,
    badge: document.querySelector('.glanceItem--act .glanceNum')?.innerText || null,
  }));
  await context.close();
  return { errors, seen };
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bad = 0;
  try {
    await waitForServer(BASE_URL, 25000);
    const browser = await chromium.launch();
    for (const vp of VIEWPORTS) {
      for (const [state, rows, notices, dark, asBefore] of [
        ['before', OPEN_ROWS, NOTICES, false, true],
        ['after', OPEN_ROWS, NOTICES, false, false],
        ['after-dark', OPEN_ROWS, NOTICES, true, false],
      ]) {
        const { errors, seen } = await shoot(browser, vp, state, rows, notices, dark, asBefore);
        if (errors.length) { bad += 1; console.log(`  [${state}-${vp.name}] PAGE ERRORS: ${errors.join(' | ')}`); }
        else console.log(`  ${state}-${vp.name}.png  badge=${seen.badge ?? '-'}  rows=${seen.rows.length}  more=${seen.more ?? '-'}`);
        seen.rows.forEach(r => console.log(`      ${r}`));
      }
    }
    await browser.close();
    console.log(bad === 0 ? 'Done. No page errors.' : `Done with ${bad} erroring captures.`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('capture-waiting-on-you crashed:', err); process.exit(1); });
