// The readable JSA, in dark mode.
//
// Fonzo found the values invisible on the superintendent's board in dark
// mode, 2026-09-11: labels and links readable, every actual answer -- job
// site, supervisor, muster point -- dark grey on a dark card. The cause
// was a literal near-black colour written when this component only ever
// appeared on white.
//
// This measures real computed colours against their real backgrounds and
// reports contrast ratios, rather than trusting a screenshot to look
// right. WCAG AA for body text is 4.5:1.
//
// Usage: node tools/testing/verify-jsa-dark-contrast.mjs <boardOwnerUuid>

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'jsadark');
mkdirSync(outDir, { recursive: true });

const PORT = 4365;
const owner = process.argv[2];
if (!owner) {
  console.error('Usage: node tools/testing/verify-jsa-dark-contrast.mjs <boardOwnerUuid>');
  process.exit(1);
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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bad = 0;
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/#/sign/${owner}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // Open the first board so the JSA contents render.
    const pick = page.locator('.crewPick:not([disabled])').first();
    if (await pick.count()) { await pick.click(); await page.waitForTimeout(1200); }

    /* The app's dark mode, applied the way the app applies it. The crew
       page itself never sets this -- it stays light on purpose -- but the
       same component renders inside the app on the superintendent's board,
       which does.

       The crew page's OWN card stays white, so measuring here without
       neutralising it compares near-white text against near-white card and
       reports everything as broken. That is a bug in the measurement, not
       in the page: it is a context that does not exist. Ancestor fills are
       cleared so the surface behind the text is the app's real dark card
       colour (--surface, #1A1A1D), which is where this component actually
       renders in the app. */
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      const doc = document.querySelector('.jsaDoc');
      let n = doc && doc.parentElement;
      while (n && n !== document.documentElement) {
        n.style.background = 'transparent';
        n = n.parentElement;
      }
      document.body.style.background = '#1A1A1D';
    });
    await page.waitForTimeout(600);

    const readings = await page.evaluate(() => {
      function rgb(s) {
        const m = (s || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(n => parseFloat(n));
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
      }
      function lum({ r, g, b }) {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      }
      function bgOf(el) {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = rgb(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0.05) return c;
          n = n.parentElement;
        }
        return { r: 15, g: 15, b: 17, a: 1 };
      }
      function ratio(el) {
        const fg = rgb(getComputedStyle(el).color);
        const bg = bgOf(el);
        if (!fg) return null;
        const a = lum(fg), b = lum(bg);
        const hi = Math.max(a, b), lo = Math.min(a, b);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      }
      const out = [];
      const sample = (sel, what) => {
        const el = document.querySelector(sel);
        if (!el) return;
        out.push({ what, text: (el.textContent || '').trim().slice(0, 34), ratio: ratio(el) });
      };
      sample('.jsaLine strong', 'a value (job site, supervisor…)');
      sample('.jsaLine span', 'a label');
      sample('.jsaDocTitle', 'section heading');
      sample('.jsaBoxTitle', 'task/hazard box heading');
      sample('.jsaBoxList li', 'a task line');
      sample('.jsaAck', 'the acknowledgement');
      sample('.jsaTelLink', 'a phone link');
      return out;
    });

    console.log('Contrast in dark mode (WCAG AA body text needs 4.5:1)\n');
    readings.forEach((r) => {
      const ok = r.ratio >= 4.5;
      if (!ok) bad += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(r.ratio).padStart(6)}:1  ${r.what}`);
      console.log(`              "${r.text}"`);
    });

    await page.screenshot({ path: path.join(outDir, 'jsa-dark.png'), fullPage: true });
    console.log(`\n${readings.length - bad}/${readings.length} readable`);
    await browser.close();
  } finally {
    killTree(server.pid);
  }
  if (bad) process.exit(1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
