// The QR handoff on the two documents that gained it 2026-09-28: Medical
// Event (employee signature) and Incident Report (each witness's statement
// and signature). Both sides -- the iPad and the phone -- plus real PDFs.
//
//   node tools/testing/capture-qr-everywhere.mjs [outDir]
//
// STUBBED, same as capture-employee-handoff-walkthrough.mjs and said out
// loud for the same reason: the module that writes the request to the
// database is replaced so the QR / "it came back" states can be shot
// without a login, and the phone page's two database calls are answered
// locally. Everything on screen is the real component. The real database
// path is the one Disciplinary/Separation already use unchanged
// (verify-employee-handoff.mjs).

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'qr-everywhere');
mkdirSync(outDir, { recursive: true });

const PORT = 4471;
const BASE = `http://localhost:${PORT}`;
const MED_KEY = 'sdc.medical.draft.v1';
const INC_KEY = 'sdc.incident.draft.v1';
const FAKE = 'exampleonly-thisisnotarealcode-00000000000';

const fixture = name => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const MED = fixture('medical-non-occupational.json');
const INC = fixture('incident-full-fixture.json');
const SIG = MED.supervisorSignatureData; // a real drawn signature from the fixture

const WITNESS_WORDS = 'i was on the 2nd lift, seen him step back off the curb onto the tag line & go down. he got up, said his wrist hurt -- walked him to the truck.';

const STUB = `
  export function employeeUrlFor(t) { return location.origin + location.pathname + '#/me/' + t; }
  export async function createHandoff() { return { token: '${FAKE}', url: employeeUrlFor('${FAKE}') }; }
  export async function checkHandoff() {
    const a = window.__answer;
    if (!a) return { waiting: true, expired: false };
    return { waiting: false, statement: a.statement || '', signatureData: a.signatureData || null, respondedAt: new Date().toISOString() };
  }
  export async function cancelHandoff() {}
`;

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => fetch(url).then(() => resolve()).catch(() => {
      if (Date.now() > deadline) reject(new Error('server not ready'));
      else setTimeout(tryOnce, 300);
    });
    tryOnce();
  });
}

const shots = [];
async function shot(target, name, note, opts) {
  await target.screenshot({ path: path.join(outDir, `${name}.png`), ...opts });
  shots.push(name);
  console.log(`  ${name}.png — ${note}`);
}

async function drawOn(page) {
  const canvas = page.locator('canvas.signatureCanvas, canvas').first();
  await canvas.waitFor({ state: 'visible' });
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.7);
  await page.mouse.down();
  for (const [fx, fy] of [[0.3, 0.25], [0.5, 0.75], [0.7, 0.3], [0.85, 0.6]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 6 });
  }
  await page.mouse.up();
  await page.locator('button', { hasText: /^(Done|Save)$/ }).first().click();
  await page.waitForTimeout(300);
}

async function office(browser, key, model) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(([k, j]) => localStorage.setItem(k, j), [key, JSON.stringify(model)]);
  await ctx.route(/\/assets\/handoffRequests-.*\.js$/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  PAGE ERROR:', String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}

async function pdf(page, name) {
  await page.getByRole('tab').last().click();
  await page.waitForTimeout(600);
  await page.locator('.reviewPrimaryAction button, button:has-text("Want a paper copy first?"), button:has-text("Update the printout")').first().click();
  await page.locator('.pdfReadyPanel').waitFor({ timeout: 180000 });
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /download/i }).first().click();
  await (await dl).saveAs(path.join(outDir, `${name}.pdf`));
  console.log(`  ${name}.pdf`);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    /* The installed Chrome when Playwright's own download is missing or a
       version behind -- installing browsers is not this script's call. */
    const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

    // ── MEDICAL EVENT — iPad ────────────────────────────────────────────
    console.log('\nMEDICAL EVENT — iPad');
    {
      const fresh = { ...MED, employeeSignatureData: null, employeeSignatureDate: '', employeeSignMethod: '', employeeResponseAt: '' };
      const { ctx, page } = await office(browser, MED_KEY, fresh);
      await page.getByRole('tab', { name: /Signature/i }).first().click();
      await page.waitForTimeout(600);
      await shot(page, 'med-1-fork', 'Signatures step: the new question, nothing picked yet', { fullPage: true });

      await page.getByRole('button', { name: 'On this device', exact: true }).click();
      await page.locator('.signaturePad', { hasText: 'Employee Signature' }).getByRole('button', { name: 'Add signature' }).click();
      await drawOn(page);
      await shot(page, 'med-2-device', '"On this device": employee signs the iPad', { fullPage: true });

      await page.getByRole('button', { name: 'They are not signing', exact: true }).click();
      await page.waitForTimeout(300);
      await shot(page, 'med-3-none', '"They are not signing": line prints blank', { fullPage: true });

      await page.getByRole('button', { name: 'On their own phone', exact: true }).click();
      await page.waitForTimeout(800);
      await shot(page, 'med-4-phone-offer', '"On their own phone": the offer', { fullPage: true });
      await page.getByRole('button', { name: /Show the (QR )?code/i }).click();
      await page.waitForSelector('.empQr', { timeout: 20000 });
      await shot(page.locator('.empPanel').first(), 'med-5-phone-code', 'the code to scan (points nowhere)');

      await page.evaluate(sig => { window.__answer = { signatureData: sig }; }, SIG);
      await page.waitForSelector('.empPanelDone', { timeout: 15000 });
      await page.waitForTimeout(500);
      await shot(page, 'med-6-phone-back', 'it came back: signature sealed in place', { fullPage: true });

      await pdf(page, 'med-draft-signed-on-phone');
      await ctx.close();
    }
    {
      // An approved (final) one, signed on the phone.
      const final = { ...MED, status: 'ready', employeeSignMethod: 'phone', employeeResponseAt: '2026-09-28T14:05:00.000Z', employeeSignatureDate: '2026-09-28' };
      const { ctx, page } = await office(browser, MED_KEY, final);
      await pdf(page, 'med-final-signed-on-phone');
      await ctx.close();
    }
    {
      // "Not signing" with an old signature still saved: must NOT print it.
      const none = { ...MED, employeeSignMethod: 'none' };
      const { ctx, page } = await office(browser, MED_KEY, none);
      await pdf(page, 'med-draft-not-signing');
      await ctx.close();
    }

    // ── INCIDENT — witnesses, iPad ──────────────────────────────────────
    console.log('\nINCIDENT — iPad');
    {
      const draft = { ...INC, status: 'draft', completedAt: '' };
      draft.witnesses = INC.witnesses.map((w, i) => (i === 0
        ? { ...w, statement: '', signatureData: null, signatureDate: '' }
        : w));
      const { ctx, page } = await office(browser, INC_KEY, draft);
      await page.getByRole('tab', { name: /Witness/i }).first().click();
      await page.waitForTimeout(700);
      const card1 = page.locator('.witnessCard').first();
      await shot(card1, 'inc-1-witness-default', 'Witness 1: new question, defaults to "On this device" (works like before)');

      await card1.getByRole('button', { name: 'On their own phone', exact: true }).click();
      await page.waitForTimeout(800);
      await shot(card1, 'inc-2-witness-offer', 'Witness 1 → "On their own phone"');
      await card1.getByRole('button', { name: /Show the (QR )?code/i }).click();
      await page.waitForSelector('.empQr', { timeout: 20000 });
      await shot(card1, 'inc-3-witness-code', 'the code for this one witness');

      await page.evaluate(([sig, words]) => { window.__answer = { statement: words, signatureData: sig }; }, [SIG, WITNESS_WORDS]);
      await page.waitForSelector('.empPanelDone', { timeout: 15000 });
      await page.waitForTimeout(500);
      await shot(card1, 'inc-4-witness-back', 'their statement + signature landed, sealed');
      await shot(page, 'inc-5-witnesses-step', 'whole Witnesses step after', { fullPage: true });

      await pdf(page, 'inc-draft-witness-from-phone');
      await ctx.close();
    }
    {
      const final = { ...INC };
      final.witnesses = INC.witnesses.map((w, i) => (i === 0
        ? { ...w, statement: WITNESS_WORDS, signatureData: SIG, signatureDate: '2026-09-28', signMethod: 'phone', responseAt: '2026-09-28T14:05:00.000Z' }
        : w));
      const { ctx, page } = await office(browser, INC_KEY, final);
      await pdf(page, 'inc-final-witness-from-phone');
      await ctx.close();
    }

    // ── THE PHONE ───────────────────────────────────────────────────────
    console.log('\nPHONE');
    const rows = {
      incidentWitness: {
        doc_type: 'incidentWitness', requested_by_name: 'Alfonso Hernandez', employee_name: INC.witnesses[0]?.name || 'Dale Pruitt',
        document: {
          witnessName: INC.witnesses[0]?.name || '', incidentDate: INC.incidentDate, incidentTime: INC.incidentTime,
          workplaceLocation: INC.workplaceLocation, incidentSpecificLocation: INC.incidentSpecificLocation,
        },
        needs: ['statement', 'signature'], expires_at: '2099-01-01T00:00:00Z',
      },
      medicalEvent: {
        doc_type: 'medicalEvent', requested_by_name: 'Alfonso Hernandez', employee_name: MED.employeeName,
        document: { ...MED, employeeSignatureData: null }, needs: ['signature'], expires_at: '2099-01-01T00:00:00Z',
      },
    };
    for (const [kind, row] of Object.entries(rows)) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      await ctx.route(/rpc\/employee_request_for/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) }));
      await ctx.route(/rpc\/submit_employee_response/, r => r.fulfill({ status: 200, contentType: 'application/json', body: 'true' }));
      const page = await ctx.newPage();
      page.on('pageerror', e => console.log('  PAGE ERROR:', String(e)));
      await page.goto(`${BASE}#/me/${FAKE}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await shot(page, `phone-${kind}-1-open`, `${kind}: what they see when they scan`, { fullPage: true });
      if (row.needs.includes('statement')) await page.locator('.empTextarea').fill(WITNESS_WORDS);
      await page.getByRole('button', { name: /Add signature/i }).first().click();
      await page.waitForTimeout(600);
      await drawOn(page);
      await shot(page, `phone-${kind}-2-ready`, `${kind}: filled in, ready to send`, { fullPage: true });
      await page.getByRole('button', { name: /Send it back/i }).click();
      await page.waitForTimeout(1500);
      await shot(page, `phone-${kind}-3-sent`, `${kind}: sent`, { fullPage: true });
      await ctx.close();
    }

    await browser.close();
    console.log(`\n${shots.length} screens saved to ${outDir}`);
  } catch (err) {
    console.error('\nSTOPPED after', shots.length, 'screens:', err?.message || err);
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main();
