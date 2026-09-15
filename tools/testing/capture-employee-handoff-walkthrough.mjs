// Every screen in the handoff, both sides of it, in the order they happen.
//
//   node tools/testing/capture-employee-handoff-walkthrough.mjs [outDir]
//
// Fonzo asked for a walkthrough: "what I see on my end, what the employee
// can see on their end... step by step as to what I'm gonna do, what
// they're gonna do."
//
// The management side is captured on an iPad-width screen, the employee
// side on a phone, because that is how each one is actually held.
//
// ONE THING HERE IS STUBBED, and it matters that it is said out loud: the
// module that writes the request to the database is replaced so the QR and
// "he sent it back" states can be photographed without a password. The
// screens, wording and buttons are the real components with real props --
// what is faked is the token in the code, which is a dead string. That the
// real database path works is proven separately, by
// verify-employee-handoff.mjs, which stubs nothing.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'handoff-walkthrough');
mkdirSync(outDir, { recursive: true });

const PORT = 4469;
const BASE = `http://localhost:${PORT}`;
const DRAFT_KEY = 'sdc.discipline.draft.v1';

/* A notice that reads like a real one: a specific thing that happened on a
   specific day, not "test test test". Clean fixtures have passed review
   before while hiding real layout problems. */
const DRAFT = {
  employeeName: 'Marcus Webb',
  position: 'Equipment Operator',
  supervisor: 'Kris Langley',
  jobSite: 'Entergy TAPS',
  noticeDate: '2026-09-15',
  warningLevel: 'written',
  whatOccurred: 'Left the designated shelter during an active lightning stand-down and returned to his truck in the equipment yard.',
  earlierWarnings: 'Verbal, 08/21/2026 — same issue, discussed at the tailgate.',
  companyPolicyStates: 'All personnel remain in the designated shelter until the stand-down is lifted by the site safety representative.',
  correctiveActionRequired: 'Remain in the designated shelter until the stand-down is called off. Any further occurrence goes to a final warning.',
  managerName: 'Alfonso Hernandez - Safety Manager',
};

/* The dead token in the picture. Long enough to draw a realistic QR, and
   pointed at nothing -- it is not in any database and never was. */
const FAKE = 'exampleonly-thisisnotarealcode-00000000000';

const STUB = `
  export function employeeUrlFor(t) {
    return location.origin + location.pathname + '#/me/' + t;
  }
  export async function createHandoff() {
    return { token: '${FAKE}', url: employeeUrlFor('${FAKE}') };
  }
  /* Answers "still waiting" until the walkthrough flips it, so the QR
     screen can be photographed before the arrival screen is. */
  export async function checkHandoff() {
    if (!window.__handoffAnswered) return { waiting: true, expired: false };
    return {
      waiting: false,
      statement: 'I went to my truck to get a rain jacket. I did not know that counted as leaving the shelter.',
      signatureData: window.__fakeSignature || null,
      respondedAt: new Date().toISOString(),
    };
  }
  export async function cancelHandoff() {}
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

const shots = [];
async function shot(page, name, note, opts) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, ...opts });
  shots.push(name);
  console.log(`  ${name}.png — ${note}`);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    // ── His end: an iPad in a job trailer ───────────────────────────────
    console.log('\nMANAGEMENT — iPad');
    const office = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await office.addInitScript(([key, draft]) => {
      localStorage.setItem(key, draft);
    }, [DRAFT_KEY, JSON.stringify(DRAFT)]);
    await office.route(/\/assets\/handoffRequests-.*\.js$/, r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB,
    }));

    const mgr = await office.newPage();
    await mgr.goto(BASE, { waitUntil: 'networkidle' });
    await mgr.waitForTimeout(1200);

    /* Opened from Home, not from Documents > Start. "Start" on a document
       that already has a draft asks whether to throw the draft away, which
       is the opposite of what this walkthrough is showing -- and it is also
       how a real person picks up a notice they were part-way through. */
    await mgr.getByRole('button', { name: /^Continue/ }).first().click();
    await mgr.waitForTimeout(1400);
    await shot(mgr, '1-mgmt-notice', 'the notice, filled in — unchanged from today', { fullPage: true });

    /* By visible text, not accessible name: the step buttons put their
       number and label in separate spans and getByRole finds neither. */
    await mgr.locator('.stepNav button', { hasText: 'SIGNATURE' }).first().click();
    await mgr.waitForTimeout(1200);
    const panel = mgr.locator('.empPanel').first();
    await panel.scrollIntoViewIfNeeded().catch(() => {});
    await mgr.waitForTimeout(400);
    await shot(mgr, '2-mgmt-offer', 'the signatures step: the offer sits above the pads');
    await shot(panel, '2b-mgmt-offer-close', 'the offer on its own');

    await mgr.getByRole('button', { name: /Show the code/i }).first().click();
    await mgr.waitForSelector('.empQr', { timeout: 20000 }).catch(() => {});
    await mgr.waitForTimeout(800);
    await shot(panel, '3-mgmt-code', 'the code he holds up (this one points nowhere)');

    // ── Her end: the employee's own phone ───────────────────────────────
    console.log('\nEMPLOYEE — phone');
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    /* The employee's phone talks to the real database. It is given a token
       by hand rather than by scanning, because the code above is a stub --
       so this half only runs when a live token is passed in. */
    const liveToken = process.env.SDC_HANDOFF_TOKEN;
    if (liveToken) {
      const emp = await phone.newPage();
      await emp.goto(`${BASE}#/me/${liveToken}`, { waitUntil: 'networkidle' });
      await emp.waitForTimeout(2500);
      await shot(emp, '4-emp-open', 'what he gets when he scans: the whole notice', { fullPage: true });

      await emp.locator('.empTextarea').fill(
        'I went to my truck to get a rain jacket. I did not know that counted as leaving the shelter.',
      ).catch(() => {});
      await emp.waitForTimeout(300);
      await shot(emp, '5-emp-statement', 'his statement, in his words', { fullPage: true });

      await emp.getByRole('button', { name: /Add signature/i }).first().click().catch(() => {});
      await emp.waitForTimeout(800);
      await shot(emp, '6-emp-sign-sheet', 'the signing sheet — pop-up, background dimmed');

      const canvas = emp.locator('canvas').first();
      if (await canvas.count()) {
        const box = await canvas.boundingBox();
        await emp.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.6);
        await emp.mouse.down();
        for (let i = 1; i <= 14; i += 1) {
          await emp.mouse.move(
            box.x + box.width * (0.18 + i * 0.045),
            box.y + box.height * (0.6 - Math.sin(i * 0.8) * 0.28),
          );
        }
        await emp.mouse.up();
        await emp.waitForTimeout(300);
        await shot(emp, '7-emp-signed-sheet', 'signed, before he taps Done');
        await emp.getByRole('button', { name: /^Done$/ }).first().click().catch(() => {});
        await emp.waitForTimeout(600);
      }
      await shot(emp, '8-emp-ready', 'ready to send', { fullPage: true });

      /* The very signature he just drew, handed to the management page, so
         the arrival screen below shows his real mark rather than an empty
         pad. Read BEFORE sending: the moment he sends, the whole page is
         replaced by the "Sent" card and the preview is gone from the DOM.
         Reading it afterwards silently produced null and put an empty pad
         in the walkthrough. */
      const drawn = await emp.evaluate(() => {
        const img = document.querySelector('.signaturePreview, .signaturePad img');
        return img ? img.src : null;
      }).catch(() => null);
      console.log(`  (his signature: ${drawn ? `${Math.round(drawn.length / 1024)}KB captured` : 'NOT CAPTURED'})`);
      if (drawn) await mgr.evaluate(src => { window.__fakeSignature = src; }, drawn);

      await emp.getByRole('button', { name: /Send it back/i }).first().click().catch(() => {});
      await emp.waitForTimeout(3000);
      await shot(emp, '9-emp-sent', 'and he is done — the link will not open again', { fullPage: true });
    } else {
      console.log('  SKIPPED — no SDC_HANDOFF_TOKEN. The employee half talks to the real');
      console.log('  database and needs a live token; nothing about it is faked here.');
    }

    // ── Back on his end: it arrives ─────────────────────────────────────
    console.log('\nMANAGEMENT — it comes back');
    await mgr.evaluate(() => { window.__handoffAnswered = true; });
    await mgr.waitForTimeout(6000);
    await mgr.locator('.empPanelDone').first().scrollIntoViewIfNeeded().catch(() => {});
    await mgr.waitForTimeout(400);
    await shot(mgr, '10-mgmt-arrived', 'it lands on his screen by itself, no refresh');

    /* And where his words actually end up. Section 4 is back on the first
       step, so the arrival screen alone does not show it -- which is the
       whole reason this screen is captured too. */
    await mgr.locator('.stepNav button', { hasText: 'NOTICE DETAILS' }).first().click();
    await mgr.waitForTimeout(1000);
    const section4 = mgr.locator('.numberedSection', { hasText: 'Employee Statement' }).first();
    await section4.scrollIntoViewIfNeeded().catch(() => {});
    await mgr.waitForTimeout(400);
    await shot(section4, '11-mgmt-statement', 'his words, typed into section 4 for him')
      .catch(() => shot(mgr, '11-mgmt-statement', 'section 4 (whole screen)', { fullPage: true }));

    await browser.close();
    console.log(`\n${shots.length} screens saved to ${outDir}`);
  } catch (err) {
    /* Printed here, not from main().catch: the finally below exits the
       process, so an outer handler never gets a turn and the failure looks
       like the script simply stopped. */
    console.error('\nSTOPPED after', shots.length, 'screens:', err?.message || err);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('walkthrough capture crashed:', err); process.exit(1); });
