// One iPad, a line of men, forty signatures.
//
//   node tools/testing/stress-forty-signers.mjs [count]
//
// Fonzo, 2026-09-14: "simulate forty people using it at the same time".
//
// For this app that is not forty browsers -- it is ONE device handed down a
// line. Fonzo's crew is 50+, the kiosk captures no names and is numbered
// only, and the real morning is seconds per man with the iPad never leaving
// somebody's hands (see the jsa-crew-signin-real-workflow note). So the
// stress that matters is: does the thing survive being hammered forty times
// in a row, and is every signature still there at the end?
//
// What this is actually watching for:
//   - a crash, at any point in the line
//   - a signature silently lost -- the count must equal the men who signed
//   - the draft on the device growing until the browser refuses to save it,
//     which would lose the sheet rather than a signature
//   - the pad getting slower as it fills, because a queue of men waiting is
//     how a sign-in stops happening at all
//
// Never signs in and never publishes, so nothing reaches the real board.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'forty');
mkdirSync(outDir, { recursive: true });

const PORT = 4404;
const BASE = `http://localhost:${PORT}`;
const COUNT = Number(process.argv[2]) || 40;
const DRAFT_KEY = 'sdc.jsa.draft.v4';
const draft = readFileSync(path.join(__dirname, 'fixtures', 'entergy-taps-draft.json'), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
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

async function sign(page, canvas, seed) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('the signature pad is not on screen');
  const x0 = box.x + box.width * 0.15;
  const y0 = box.y + box.height * (0.5 + (seed % 40) / 200);
  const amp = box.height * 0.1;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(x0 + i * (box.width * 0.08), y0 + Math.sin(i + seed) * amp);
  }
  await page.mouse.up();
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    /* An iPad in landscape, because that is what sits on the tailgate. */
    const context = await browser.newContext({
      viewport: { width: 1180, height: 820 }, hasTouch: true,
    });
    await context.addInitScript(d => localStorage.setItem('sdc.jsa.draft.v4', d), draft);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const cont = page.getByRole('button', { name: /^Continue/i }).first();
    if (await cont.count()) { await cont.click().catch(() => {}); await page.waitForTimeout(700); }

    /* The last step is where the crew signs. */
    const steps = page.locator('.stepNavRow');
    await steps.nth((await steps.count()) - 1).click().catch(() => {});
    await page.waitForTimeout(800);

    const startBtn = page.getByRole('button', { name: /Start Crew Sign-In/i }).first();
    if (!(await startBtn.count())) {
      const steps2 = await page.locator('.stepNavRow').allInnerTexts();
      const btns = (await page.locator('button').allInnerTexts())
        .map(b => b.replace(/\s+/g, ' ').trim()).slice(0, 30);
      check('the kiosk can be opened at all', false,
        `steps: ${JSON.stringify(steps2)} buttons: ${JSON.stringify(btns)}`);
      await browser.close();
      return;
    }
    await startBtn.click();
    await page.locator('.crewKiosk').waitFor({ state: 'visible', timeout: 5000 });
    check('the kiosk opens', true);

    const canvas = page.locator('.crewKioskCanvas');
    const confirm = page.locator('.crewKioskConfirm');
    const number = page.locator('.crewKioskNumber');

    const timings = [];
    let crashedAt = 0;
    let lostAt = 0;

    for (let man = 1; man <= COUNT; man += 1) {
      const t0 = Date.now();
      try {
        await sign(page, canvas, man * 7);
        await confirm.click({ timeout: 4000 });
        /* The confirmation flashes up and clears itself before the next
           man steps in; waiting for it to go is what "next please" means. */
        await page.locator('.crewKioskConfirmedOverlay')
          .waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
      } catch (ex) {
        crashedAt = man;
        check(`man #${man} could sign`, false, ex.message);
        break;
      }
      timings.push(Date.now() - t0);

      if (await page.locator('text=Something went wrong').count()) { crashedAt = man; break; }

      /* The counter is the crew's own proof that a man is on the sheet. */
      const shown = await number.innerText().catch(() => '');
      if (man < COUNT && !shown.includes(`#${man + 1}`)) { lostAt = man; break; }
    }

    check(`all ${COUNT} men signed without the app dying`, crashedAt === 0,
      crashedAt ? `died on man #${crashedAt}` : '');
    check('the counter never skipped or stalled', lostAt === 0,
      lostAt ? `stuck after man #${lostAt}` : '');

    /* Out of the kiosk, and count what was actually kept. */
    const exit = page.getByRole('button', { name: /Done|Exit|Finish|Close/i }).first();
    if (await exit.count()) { await exit.click().catch(() => {}); await page.waitForTimeout(800); }

    const saved = await page.evaluate((key) => {
      try {
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
        const sigs = raw && Array.isArray(raw.crewSignatures) ? raw.crewSignatures : [];
        return { count: sigs.length, bytes: (localStorage.getItem(key) || '').length };
      } catch (e) { return { count: -1, bytes: -1, error: String(e) }; }
    }, DRAFT_KEY);

    const expected = crashedAt ? crashedAt - 1 : COUNT;
    check(`every signature was kept (${saved.count} of ${expected})`,
      saved.count >= expected, `saved ${saved.count}, expected ${expected}`);

    const mb = (saved.bytes / 1048576).toFixed(2);
    check(`the sheet still fits on the device (${mb} MB)`, saved.bytes > 0 && saved.bytes < 4.5 * 1048576,
      `${mb} MB of a ~5 MB browser limit`);

    if (timings.length >= 10) {
      const first5 = timings.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const last5 = timings.slice(-5).reduce((a, b) => a + b, 0) / 5;
      check('the pad does not get slower as the line goes on',
        last5 < first5 * 2.5,
        `first five averaged ${Math.round(first5)}ms, last five ${Math.round(last5)}ms`);
    }

    check('no errors thrown anywhere in the line', pageErrors.length === 0,
      pageErrors.slice(0, 2).join(' | '));

    await page.screenshot({ path: path.join(outDir, 'after-forty.png'), fullPage: true }).catch(() => {});
    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED`);
    process.exit(0);
  }
}

main().catch(err => { console.error('forty-signer stress crashed:', err); process.exit(1); });
