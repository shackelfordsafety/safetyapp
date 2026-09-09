// The bottom nav now carries seven items instead of six, so this checks
// the labels still actually READ at real phone widths rather than getting
// quietly chopped to "Templ…".
//
// That matters more here than in most apps: the men using this skew older
// and not especially tech-savvy, and the standing rule for this project is
// visible labels over icon-only guessing. An ellipsis is a label that has
// stopped doing its job.
//
// Usage: node tools/testing/verify-mobile-nav.mjs

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'mobilenav');
mkdirSync(outDir, { recursive: true });

const PORT = 4331;
const BASE_URL = `http://localhost:${PORT}`;

// The narrow end of what's actually in pockets, not just an iPhone.
const WIDTHS = [
  { name: '360-android', width: 360, height: 800 },
  { name: '375-iphone-se', width: 375, height: 667 },
  { name: '390-iphone-14', width: 390, height: 844 },
  { name: '430-iphone-pro-max', width: 430, height: 932 },
];

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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bad = 0;
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();

    for (const size of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);

      const items = await page.locator('.mobileNavItem').evaluateAll(els => els.map((el) => {
        const span = el.querySelector('span');
        return {
          label: span.textContent.trim(),
          // scrollWidth past clientWidth is the browser telling us it had
          // to chop the text.
          truncated: span.scrollWidth > span.clientWidth + 1,
          box: Math.round(el.getBoundingClientRect().width),
          tall: Math.round(el.getBoundingClientRect().height),
        };
      }));

      const chopped = items.filter(i => i.truncated).map(i => i.label);
      const tooSmall = items.filter(i => i.tall < 44).map(i => i.label);
      if (chopped.length || tooSmall.length) bad += 1;

      console.log(`\n[${size.name}] ${size.width}px — ${items.length} items, ${items[0]?.box}px each`);
      console.log(`   labels: ${items.map(i => i.label).join(' · ')}`);
      console.log(`   chopped: ${chopped.length ? chopped.join(', ') : 'none'}`);
      console.log(`   under 44px tall (touch target): ${tooSmall.length ? tooSmall.join(', ') : 'none'}`);

      const hasBoard = items.some(i => /board/i.test(i.label));
      console.log(`   Board reachable: ${hasBoard}`);
      if (!hasBoard) bad += 1;

      await page.screenshot({ path: path.join(outDir, `${size.name}.png`) });
      await context.close();
    }

    await browser.close();
    console.log(bad === 0 ? '\nPASS  every label readable at every width, Board present.' : `\n${bad} width(s) need work`);
    process.exitCode = bad === 0 ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
