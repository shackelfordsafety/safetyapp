// The Acknowledgement / Approvals block, on the Review screen AND in the
// real PDF, from a draft you point it at.
//
//   node tools/testing/capture-separation-approvals.mjs <draftJson> [outDir]
//
// Fonzo, 2026-09-14, on a real signed separation: "why is the name not
// under the signature line? ... we need to make it so the person's name
// that's signing is underneath their signature and the dates right next
// to it."
//
// Takes the draft as an argument rather than shipping a fixture, because
// the only draft worth checking this against was a real separation for a
// real person, and that does not belong in the repository.
//
// Does BOTH surfaces on purpose. The Review screen is a facsimile, not the
// form -- it and separationPdfDraw are two separate block lists that are
// meant to mirror each other and had already drifted (the witness printed
// in the PDF and was missing from the preview). Checking one proves
// nothing about the other.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const [draftPath, outArg] = process.argv.slice(2);
if (!draftPath) {
  console.error('usage: capture-separation-approvals.mjs <draftJson> [outDir]');
  process.exit(2);
}
const outDir = outArg || path.join(__dirname, 'output', 'sep-approvals');
mkdirSync(outDir, { recursive: true });

const PORT = 4432;
const BASE = `http://localhost:${PORT}`;
const KEY = 'sdc.separation.draft.v1';

const rawDraft = readFileSync(draftPath, 'utf8');
const parsed = JSON.parse(rawDraft);
const model = parsed.data || parsed;

const wait = (u, ms) => {
  const end = Date.now() + ms;
  return new Promise((res, rej) => {
    const t = () => fetch(u).then(res).catch(() => (Date.now() > end ? rej(new Error('no server')) : setTimeout(t, 300)));
    t();
  });
};

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await wait(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(model)]);
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const card = page.locator('.startDocTile', { hasText: /Employee Separation/i }).first();
    await card.getByRole('button', { name: /^(Start|Continue)/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);

    // Review is the step that renders the facsimile.
    const steps = page.locator('.stepNavRow');
    const n = await steps.count();
    for (let i = 0; i < n; i += 1) {
      await steps.nth(i).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (await page.locator('.facsimileSignatureRow').count()) break;
    }

    const lines = await page.locator('.facsimileSignatureLine').allInnerTexts();
    console.log('lines under each signature:');
    lines.map(l => l.replace(/\s+/g, ' ').trim()).forEach(l => console.log(`   ${JSON.stringify(l)}`));

    const block = page.locator('.facsimileSignatureRow').first();
    await block.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'review-approvals.png'), fullPage: true });
    console.log('saved review-approvals.png');

    /* Now the real thing. The preview is a facsimile and this repo's
       standing rule is that no print change is certified from one. */
    for (let i = 0; i < n; i += 1) {
      await steps.nth(i).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      if (await page.getByRole('button', { name: /paper copy|Create Document|Generate/i }).count()) break;
    }
    const make = page.getByRole('button', { name: /paper copy|Create Document|Generate/i }).first();
    if (await make.count()) {
      await make.click().catch(() => {});
      await page.waitForTimeout(6000);
      const dl = page.getByRole('button', { name: /Download/i }).first();
      if (await dl.count()) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
          dl.click().catch(() => {}),
        ]);
        if (download) {
          const file = path.join(outDir, 'separation.pdf');
          await download.saveAs(file);
          console.log('saved', file);
        } else console.log('no download fired');
      } else console.log('no Download button found');
    } else console.log('no way to make the PDF found');

    await browser.close();
  } finally {
    killTree(server);
    process.exit(0);
  }
}

main().catch(err => { console.error('approvals capture crashed:', err); process.exit(1); });
