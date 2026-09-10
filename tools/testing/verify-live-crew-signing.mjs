// Checks the DEPLOYED site, not a local build.
//
// "The deploy went green" only proves a build was uploaded. Before a real
// crew is asked to bet a morning on it, this loads the actual public URL a
// man's phone would load and confirms the signature pad is open and ready
// with no Save step in the way.
//
// Needs a live publication on the board. Point it at a throwaway one and
// delete that row afterwards -- never at real work.
//
// Usage: node tools/testing/verify-live-crew-signing.mjs
//   LIVE_URL=<origin/path>   defaults to the GitHub Pages site
//   ROW_TEXT=<label>         which board row to open (default "IGNORE")

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'output', 'livecheck');
mkdirSync(outDir, { recursive: true });

const LIVE = process.env.LIVE_URL || 'https://shackelfordsafety.github.io/safetyapp/';
const BOARD = process.env.BOARD_OWNER || '53ac3e37-efe3-45f6-b6ef-41be5a492afa';
const ROW_TEXT = process.env.ROW_TEXT || 'IGNORE';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const url = `${LIVE}#/sign/${BOARD}`;
console.log('Loading the live site:', url);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const rows = await page.locator('.crewPick').allInnerTexts();
console.log('Rows on the board:', rows.length ? rows.map(r => r.split('\n')[0]).join(' | ') : '(none)');

const pick = page.locator('.crewPick', { hasText: ROW_TEXT }).first();
if (await pick.count() === 0) {
  console.log(`\nNo row matching "${ROW_TEXT}" — nothing to check.`);
  await browser.close();
  process.exit(1);
}

await pick.click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Sign this one' }).click();
await page.waitForTimeout(900);

const padOpen = await page.locator('canvas.signatureCanvas').count() > 0;
const needsAdd = await page.getByRole('button', { name: /Add signature/i }).count() > 0;
const needsSave = await page.getByRole('button', { name: 'Save', exact: true }).count() > 0;

await page.locator('canvas.signatureCanvas').scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'live-signing.png'), fullPage: true });

console.log('\nOn the deployed site:');
console.log(`   pad open and ready to draw:   ${padOpen}`);
console.log(`   "Add signature" tap required: ${needsAdd}`);
console.log(`   "Save" tap required:          ${needsSave}`);
console.log('\nPage errors:', errors.length ? errors : 'none');

const ok = padOpen && !needsAdd && !needsSave && errors.length === 0;
console.log(ok ? '\nPASS  the new flow is live.' : '\nFAIL  the deployed site is still on the old flow.');
await browser.close();
process.exit(ok ? 0 : 1);
