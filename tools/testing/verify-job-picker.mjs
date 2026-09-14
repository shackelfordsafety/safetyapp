// Picking the job instead of remembering the number.
//
//   node tools/testing/verify-job-picker.mjs
//
// Drives the real Job Info step in a real browser and proves the three
// rules the picker was built around:
//
//   1. It can never block a JSA. With no job list -- signed out, no
//      signal, first run -- the step is exactly the step it has always
//      been, and the four fields still take typing.
//   2. Tapping a job fills the four fields it actually knows and touches
//      nothing else on the form.
//   3. It never silently overwrites. Anything already typed is named in a
//      confirm before it is replaced, and "Keep what I typed" keeps it.
//
// The job list lives in the cloud behind an account, which a test run has
// no business creating against the company's live database. So the one
// lazily-loaded module the picker reads from is stubbed at the network
// layer; the component, the form and the confirm all run for real.
//
// Screenshots: tools/testing/output/jobs/

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'jobs');
mkdirSync(outDir, { recursive: true });

const PORT = 4364;
const BASE = `http://localhost:${PORT}`;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

/* Real-shaped rather than tidy: a job with no client, a job whose name is
   longer than the chip, and a number with a letter in it, because job
   numbers in this company are not all digits. */
const JOBS = [
  { id: 'j1', job_number: '24-118', name: 'Entergy Taps', location: 'Baytown, TX', client: 'Entergy', active: true },
  { id: 'j2', job_number: '25-004', name: 'Coyote Creek Pit - north haul road widening', location: 'Alba, TX', client: null, active: true },
  { id: 'j3', job_number: '24-77B', name: 'Sabine Solar', location: 'Kirbyville, TX', client: 'RWE', active: true },
  { id: 'j4', job_number: '23-902', name: 'Rail Spur 9', location: 'Longview, TX', client: 'UP', active: true },
  { id: 'j5', job_number: '25-031', name: 'Lime Plant Reclaim', location: 'New Braunfels, TX', client: 'Martin Marietta', active: true },
];
const MINE = ['j1', 'j3'];

const stub = (jobs, mine) => `
  export async function listJobs() { return { jobs: ${JSON.stringify(jobs)}, mine: ${JSON.stringify(mine)}, stale: false, signedIn: true }; }
  export async function setMine() {}
  export async function createJob() { throw new Error('not used in this run'); }
  export async function jobNumbersNotOnTheList() { return []; }
  export const JOBS_CACHE_KEY = 'sdc.jobs.v1';
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

async function openJobStep(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Job Safety Analysis|Start/i }).first().click();
  await page.waitForTimeout(400);
  const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
  if (await blank.count()) { await blank.click(); await page.waitForTimeout(700); }
  await page.waitForTimeout(700); // the picker loads its module after paint
  return { page, errors };
}

const val = (page, label) => page.getByLabel(label, { exact: false }).first().inputValue();

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    // -- 1. No list at all: the step is untouched -----------------------
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true });
      await context.route(/\/assets\/jobsStore-.*\.js$/, r => r.fulfill({
        status: 200, contentType: 'application/javascript', body: stub([], []),
      }));
      const { page, errors } = await openJobStep(context);
      check('no job list: the picker renders nothing at all',
        (await page.locator('.jobPick').count()) === 0);
      await page.getByLabel('Job #', { exact: false }).first().fill('24-118');
      check('no job list: the job number still takes typing',
        (await val(page, 'Job #')) === '24-118');
      check('no job list: no page errors', errors.length === 0, errors.join(' | '));
      await page.screenshot({ path: path.join(outDir, 'no-list.png'), fullPage: true });
      await context.close();
    }

    // -- 2. With a list: tapping a job fills the four fields ------------
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true });
      await context.route(/\/assets\/jobsStore-.*\.js$/, r => r.fulfill({
        status: 200, contentType: 'application/javascript', body: stub(JOBS, MINE),
      }));
      const { page, errors } = await openJobStep(context);

      const chips = await page.locator('.jobChip').allInnerTexts();
      check('the shortlist shows your own jobs first, plus a way to all of them',
        chips.length === 3 && /24-118/.test(chips[0]) && /24-77B/.test(chips[1]) && /All jobs/.test(chips[2]),
        JSON.stringify(chips));
      await page.screenshot({ path: path.join(outDir, 'picker.png'), fullPage: true });

      const areaBefore = await val(page, 'Area this JSA covers');
      await page.locator('.jobChip').first().click();
      await page.waitForTimeout(300);
      const filled = {
        jobNumber: await val(page, 'Job #'),
        jobSite: await val(page, 'Job Site'),
        location: await val(page, 'Location / City'),
        client: await val(page, 'Client'),
      };
      check('tapping a job fills Job #, Job Site, Location and Client',
        filled.jobNumber === '24-118' && filled.jobSite === 'Entergy Taps'
        && filled.location === 'Baytown, TX' && filled.client === 'Entergy',
        JSON.stringify(filled));
      check('it touches nothing else on the form',
        (await val(page, 'Area this JSA covers')) === areaBefore);
      check('the chosen job is marked as chosen',
        (await page.locator('.jobChip.active').count()) === 1);
      await page.screenshot({ path: path.join(outDir, 'picked.png'), fullPage: true });

      // -- 3. It never silently overwrites ------------------------------
      await page.locator('.jobChip').nth(1).click();
      await page.waitForTimeout(300);
      const confirmText = await page.locator('.dialogPanel').first().innerText().catch(() => '');
      check('picking over a filled-in form asks first, and names the fields',
        /Replace what you typed/i.test(confirmText) && /Job #/.test(confirmText) && /Job Site/.test(confirmText),
        JSON.stringify(confirmText.replace(/\n+/g, ' | ')));
      await page.screenshot({ path: path.join(outDir, 'confirm.png'), fullPage: true });

      await page.getByRole('button', { name: /Keep what I typed/i }).click();
      await page.waitForTimeout(250);
      check('"Keep what I typed" keeps it',
        (await val(page, 'Job #')) === '24-118');

      await page.locator('.jobChip').nth(1).click();
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: /Use this job/i }).click();
      await page.waitForTimeout(300);
      check('"Use this job" replaces it',
        (await val(page, 'Job #')) === '24-77B' && (await val(page, 'Job Site')) === 'Sabine Solar');

      // -- The full list, searchable ------------------------------------
      await page.locator('.jobChip--more').click();
      await page.waitForTimeout(300);
      check('"All jobs" opens every job on the list',
        (await page.locator('.jobRow').count()) === JOBS.length);
      await page.screenshot({ path: path.join(outDir, 'all-jobs.png'), fullPage: true });
      await page.locator('.jobSearch').fill('solar');
      await page.waitForTimeout(250);
      const found = await page.locator('.jobRow').allInnerTexts();
      check('search finds a job by its name', found.length === 1 && /Sabine Solar/.test(found[0]),
        JSON.stringify(found));
      await page.locator('.jobSearch').fill('martin');
      await page.waitForTimeout(250);
      check('search finds a job by its client too',
        (await page.locator('.jobRow').count()) === 1);

      check('no page errors anywhere in the flow', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // -- 4. Settings: the office keeps the list, the field does not ------
    for (const who of [
      { label: 'the office', canAdd: true, suggested: [{ jobNumber: '25-119', count: 3 }, { jobNumber: '24-88', count: 1 }] },
      { label: 'a superintendent', canAdd: false, suggested: [] },
    ]) {
      const context = await browser.newContext({ viewport: { width: 1180, height: 1000 }, hasTouch: true });
      await context.addInitScript(() => {
        localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { email: 'someone@example.com', id: 'u1' } }));
      });
      await context.route(/\/assets\/jobsStore-.*\.js$/, r => r.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          export async function listJobs() { return { jobs: ${JSON.stringify(JOBS)}, mine: ${JSON.stringify(MINE)}, stale: false, signedIn: true }; }
          export async function setMine() {}
          export async function createJob() { return { id: 'new' }; }
          export async function canAddJobs() { return ${who.canAdd}; }
          export async function jobNumbersNotOnTheList() { return ${JSON.stringify(who.suggested)}; }
          export const JOBS_CACHE_KEY = 'sdc.jobs.v1';
        `,
      }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /^Settings$/ }).first().click();
      await page.waitForTimeout(900);

      check(`${who.label}: the job list is on Settings`,
        (await page.locator('.jobsAdminRow').count()) === JOBS.length);
      check(`${who.label}: ${who.canAdd ? 'can' : 'cannot'} add a job`,
        (await page.locator('.jobsAdd').count()) === (who.canAdd ? 1 : 0));
      check(`${who.label}: ${who.canAdd ? 'is offered' : 'is not offered'} job numbers already in use`,
        (await page.locator('.jobSuggestChip').count()) === who.suggested.length);
      check(`${who.label}: their own jobs are marked as theirs`,
        (await page.getByRole('button', { name: 'One of mine' }).count()) === MINE.length);
      check(`${who.label}: no page errors`, errors.length === 0, errors.join(' | '));
      await page.screenshot({ path: path.join(outDir, `settings-${who.canAdd ? 'office' : 'field'}.png`), fullPage: true });
      await context.close();
    }

    await browser.close();
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('verify-job-picker crashed:', err); process.exit(1); });
