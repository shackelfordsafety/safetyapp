// What the employee wrote and signed is not the employer's to change.
//
//   node tools/testing/verify-employee-parts-are-his.mjs
//
// Fonzo, 2026-09-15: "make sure everything the employee does can't be
// changed by the employer, for legal reasons."
//
// He is right, and the first cut of the QR handoff got it wrong: his
// statement came back into an ordinary text box, and his signature came
// back onto a pad with Replace and Remove sitting under it. A statement the
// employer can retype is worth less than no statement at all, because it
// still reads as the man's own words.
//
// This drives the real screens with a notice that already carries his
// answer and proves, by trying, that none of it can be altered -- and, just
// as important, that the lock did NOT spread to the parts of the notice
// that genuinely are management's to write.
//
// Offline on purpose. No account, no network: the seal is a property of the
// screen, and a check for it should not be able to fail because a database
// was unreachable.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'employee-owned');
mkdirSync(outDir, { recursive: true });

const PORT = 4470;
const BASE = `http://localhost:${PORT}`;

/* A 1x1 PNG. What it looks like does not matter; that it cannot be removed
   does. */
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const HIS_WORDS = 'I went to my truck for a rain jacket. I did not know that counted as leaving the shelter.';

const CASES = [
  {
    doc: 'disciplinary',
    key: 'sdc.discipline.draft.v1',
    step: 'SIGNATURE',
    draft: {
      employeeName: 'Marcus Webb',
      position: 'Equipment Operator',
      supervisor: 'Kris Langley',
      noticeDate: '2026-09-15',
      warningLevel: 'written',
      whatOccurred: 'Left the designated shelter during an active lightning stand-down.',
      companyPolicyStates: 'Remain in the shelter until the stand-down is lifted.',
      correctiveActionRequired: 'Remain in the shelter until the stand-down is lifted.',
      managerName: 'Alfonso Hernandez - Safety Manager',
      employeeStatement: HIS_WORDS,
      employeeSignatureData: SIG,
      employeeSignatureDate: '2026-09-15',
      employeeResponseAt: '2026-09-15T14:14:00.000Z',
    },
  },
  {
    doc: 'separation',
    key: 'sdc.separation.draft.v1',
    step: 'SIGNATURE',
    draft: {
      employeeName: 'Marcus Webb',
      position: 'Equipment Operator',
      supervisor: 'Kris Langley',
      separationType: 'involuntary',
      separationReason: 'Attendance',
      lastDayWorked: '2026-09-15',
      effectiveSeparationDate: '2026-09-15',
      detailedExplanation: 'Repeated no-shows after written warning.',
      dateSubmitted: '2026-09-15',
      /* Closeout has to be finished or the Signature step stays locked and
         this check silently tests nothing -- which is exactly how it first
         reported a missing signature that was really a locked step. */
      warningNoticesGiven: 'yes',
      warningNoticesCount: '2',
      eligibleForRehire: 'no',
      rehireReasonIfNo: 'Attendance',
      finalTimesheetSubmitted: true,
      expensesResolved: 'na',
      managerName: 'Alfonso Hernandez - Safety Manager',
      employeeSignatureData: SIG,
      employeeSignatureDate: '2026-09-15',
      employeeResponseAt: '2026-09-15T14:14:00.000Z',
    },
  },
];

let failed = 0;
function check(name, pass, detail) {
  if (!pass) failed += 1;
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

async function openDraft(browser, { key, draft }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addInitScript(([k, json]) => localStorage.setItem(k, json), [key, JSON.stringify(draft)]);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  /* From Home, not from Documents > Start: Start on a document that already
     has a draft offers to throw the draft away. */
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForTimeout(1400);
  return { ctx, page };
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();

    for (const c of CASES) {
      console.log(`\n── ${c.doc} ──`);
      const { ctx, page } = await openDraft(browser, c);

      // ── His statement (disciplinary only; separation has no statement) ──
      if (c.draft.employeeStatement) {
        /* Found by its VALUE, not its position: the sections above it are
           free to move around without quietly pointing this at the wrong
           box. */
        const found = await page.locator('textarea').evaluateAll(
          (els, words) => els.findIndex(e => e.value === words),
          HIS_WORDS,
        );
        check('his statement is on the screen', found >= 0);
        if (found >= 0) {
          const el = page.locator('textarea').nth(found);
          check('his statement cannot be typed into', await el.isDisabled());

          /* Not just "the attribute is set" -- actually try to change it,
             the way a manager who wanted it different would. */
          const before = await el.inputValue();
          await el.fill('He admitted fault and apologised.').catch(() => {});
          await page.waitForTimeout(400);
          const after = await page.locator('textarea').nth(found).inputValue();
          check('and typing into it changes nothing', after === before,
            after === before ? '' : `became: ${after.slice(0, 60)}`);
        }

        /* The lock must not have spread. Section 1 is management's account
           of what happened and has to stay editable. */
        const whatOccurred = await page.locator('textarea').evaluateAll(
          (els, text) => els.findIndex(e => e.value.startsWith(text)),
          'Left the designated shelter',
        );
        if (whatOccurred >= 0) {
          check("management's own sections are still editable",
            !(await page.locator('textarea').nth(whatOccurred).isDisabled()));
        }
        await page.screenshot({ path: path.join(outDir, `${c.doc}-statement.png`), fullPage: true });
      }

      // ── His signature ───────────────────────────────────────────────────
      await page.locator('.stepNav button', { hasText: c.step }).first().click();
      await page.waitForTimeout(1200);

      /* A locked step swallows the jump silently. Say so out loud rather
         than letting every check below fail as if the signature vanished. */
      const stillLocked = await page.locator('.stepNav button', { hasText: c.step })
        .first().innerText().then(t => /LOCKED/i.test(t)).catch(() => false);
      check('the signature step is reachable', !stillLocked,
        stillLocked ? 'step is locked — the fixture is missing required fields, NOT TESTED below' : '');

      const pads = page.locator('.signaturePad');
      const empPad = pads.filter({ hasText: /Employee Signature/ }).first();
      check('his signature is on the notice',
        (await empPad.locator('img.signaturePreview').count()) > 0);
      check('it cannot be replaced or removed',
        (await empPad.getByRole('button', { name: /Replace|Remove/ }).count()) === 0);

      /* The toggle above it matters just as much: flipping it to "refused"
         would print "Refused / Unavailable to Sign" over a man who signed. */
      /* The date beside his signature counts too. Moving it is falsifying
         when he acknowledged the notice, which is the whole argument in a
         dispute about whether he was told before or after something. */
      const sigDate = page.locator('.field', { hasText: /Employee Signature Date/i })
        .locator('input').first();
      if (await sigDate.count()) {
        check('the date he signed cannot be moved', await sigDate.isDisabled());
      }

      const refuse = page.getByRole('button', { name: /refused or not available/i }).first();
      if (await refuse.count()) {
        check('he cannot be recorded as refusing after he signed',
          await refuse.isDisabled());
      }

      /* And the manager's own pad must still work -- a lock that sealed the
         whole step would stop the notice being finished at all. */
      const mgrPad = pads.filter({ hasText: /Manager Signature|Management Signature/ }).first();
      if (await mgrPad.count()) {
        check("the manager's own signature is still his to add",
          (await mgrPad.getByRole('button', { name: /Add signature/ }).count()) > 0);
      }

      /* The witness too -- witnessing usually happens after all this. */
      const witPad = pads.filter({ hasText: /Witness Signature/ }).first();
      if (await witPad.count()) {
        check('the witness can still sign',
          (await witPad.getByRole('button', { name: /Add signature/ }).count()) > 0);
      }

      check('the screen says when he did it',
        /on his own phone/i.test(await page.locator('.helperText').allInnerTexts().then(a => a.join(' '))));

      await page.screenshot({ path: path.join(outDir, `${c.doc}-signature.png`), fullPage: true });
      await ctx.close();
    }

    await browser.close();
  } catch (err) {
    console.error('\nSTOPPED:', err?.message || err);
    failed += 1;
  } finally {
    killTree(server);
    console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
    process.exit(failed ? 1 : 0);
  }
}

main();
