// The separation signature step, as the man running the meeting sees it.
//
//   node tools/testing/capture-separation-signatures.mjs [outDir]
//
// Fonzo, 2026-09-14: "There should be three things on there. The manager
// that's talking to the employee, the employee, and the witness."
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'sep-signatures');
mkdirSync(outDir, { recursive: true });
const PORT = 4428;
const BASE = `http://localhost:${PORT}`;

const wait = (u, ms) => { const e = Date.now() + ms; return new Promise((r, j) => { const t = () => fetch(u).then(r).catch(() => Date.now() > e ? j(new Error('no server')) : setTimeout(t, 300)); t(); }); };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await wait(BASE, 25000);
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1180, height: 1000 } });
  const p = await c.newPage();
  await p.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: /^Settings$/ }).first().click().catch(() => {});
  await p.waitForTimeout(900);
  await p.locator('.simFill', { hasText: /Employee Separation/ }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  await p.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  const card = p.locator('.startDocTile', { hasText: /Employee Separation/i }).first();
  await card.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
  await p.waitForTimeout(1000);

  const steps = p.locator('.stepNavRow');
  const n = await steps.count();
  for (let i = 0; i < n; i += 1) {
    await steps.nth(i).click({ timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(600);
    if (await p.locator('.signaturePad').count()) break;
  }
  // The fixture has the employee refusing, which correctly hides their
  // pad. Capture the ordinary case too -- the employee IS signing.
  await p.getByRole('button', { name: /^Yes$/ }).first().click().catch(() => {});
  await p.waitForTimeout(600);

  console.log('step order:', JSON.stringify((await p.locator('.stepNavRow').allInnerTexts()).map(t => t.replace(/s+/g, ' ').trim())));
  const labels = await p.locator('.signaturePad .fieldLabel').allInnerTexts();
  console.log('signature pads on the step:', JSON.stringify(labels.map(l => l.trim())));
  await p.screenshot({ path: path.join(outDir, 'signature-step.png'), fullPage: true });
  await p.getByRole('button', { name: /refused or not available/i }).first().click().catch(() => {});
  await p.waitForTimeout(600);
  const refusedLabels = await p.locator('.signaturePad .fieldLabel').allInnerTexts();
  console.log('when the employee refuses:', JSON.stringify(refusedLabels.map(l => l.trim())));
  await p.screenshot({ path: path.join(outDir, 'signature-step-refused.png'), fullPage: true });
  console.log('saved', path.join(outDir, 'signature-step.png'));
  await b.close();
} finally { killTree(server); process.exit(0); }
