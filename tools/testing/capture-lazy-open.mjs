/* What a person actually sees when the four Superintendent documents now
   load on demand.

   The whole visible cost of moving pdf-lib out of the download is a
   moment of "Opening the form..." the first time one of these is opened.
   On a laptop that is too fast to photograph, so this deliberately
   throttles the connection to something like bad site signal and catches
   it -- then shows the same screen a moment later, fully open.

     node tools/testing/capture-lazy-open.mjs                         */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'lazy-open');
mkdirSync(outDir, { recursive: true });

const PORT = 4394;
const BASE_URL = `http://localhost:${PORT}`;

const DOCS = [
  ['Disciplinary Notice', 'disciplinary'],
  ['Employee Separation', 'separation'],
  ['Medical Event', 'medical-event'],
  ['Uncontrolled Event', 'uncontrolled-event'],
];

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => fetch(url).then(() => resolve()).catch(() => {
      if (Date.now() > deadline) reject(new Error('server never came up'));
      else setTimeout(tryOnce, 300);
    });
    tryOnce();
  });
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(BASE_URL, 25000);
  const browser = await chromium.launch();

  for (const [label, slug] of DOCS) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    /* Hold the workflow's own chunk back long enough to see the wait.
       Everything else loads at full speed, so this is the real screen,
       not a mock-up of one. */
    let released;
    const hold = new Promise(r => { released = r; });
    await page.route('**/assets/*.js', async (route) => {
      const url = route.request().url();
      if (/Workflow|pdfDraw|pdf-lib|index-/i.test(url) && /Workflow/i.test(url)) {
        await hold;
      }
      await route.continue();
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `Start ${label}` }).first().click();
    await page.waitForTimeout(500);

    const waiting = await page.locator('text=Opening the form').count();
    await page.screenshot({ path: path.join(outDir, `${slug}-1-opening.png`) });

    released();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, `${slug}-2-open.png`), fullPage: false });

    const openedOk = errors.length === 0;
    console.log(`${label}: waiting state seen = ${waiting > 0}, opened clean = ${openedOk}`);
    if (!openedOk) console.log(`   ${errors.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\nscreenshots -> ${outDir}`);
  console.log('--- result ---');
} finally {
  killTree(server);
}
process.exit(0);
