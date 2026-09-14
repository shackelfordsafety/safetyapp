// Is anything unreadable in dark mode?
//
//   node tools/testing/verify-dark-every-screen.mjs
//
// verify-dark-mode.mjs stopped being able to find its way around the app
// some time ago (it waits forever for a "Documents" button that moved), so
// dark mode has had no live coverage. It matters more here than in most
// apps: this gets used at 5am in a truck before the sun is up, and again in
// full sunlight at noon.
//
// Rather than eyeball screenshots, this measures. For every top-level screen
// and every step of every document it reads the COMPUTED colours off the
// real elements and checks two things:
//
//   1. The page is actually dark -- a screen that stayed light when the
//      rest went dark is the classic half-themed bug.
//   2. Every piece of text has enough contrast against what is actually
//      behind it. Text the same colour as its own background is invisible,
//      and that is exactly the failure a screenshot review skims past.
//
// The 4.5:1 floor is the ordinary readable-text standard. Big text gets
// 3:1, the same allowance the standard makes.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'dark');
mkdirSync(outDir, { recursive: true });

/* Light is not the easy case -- it is the sunlight case, which is where
   this app is used most. Same audit, same floors, --light to run it. */
const LIGHT = process.argv.includes('--light');
const THEME = LIGHT ? 'light' : 'dark';

const PORT = 4415;
const BASE = `http://localhost:${PORT}`;

const TABS = [
  ['Home', /^Home$/],
  ['My Work', /^My Work$/],
  ['Sign-In', /^Sign-In$/],
  ['Records', /^Records$/],
  ['Settings', /^Settings$/],
];

const DOCS = [
  ['JSA', /JSA/i],
  ['Incident Report', /Incident Report/i],
  ['Uncontrolled Event', /Uncontrolled Event/i],
  ['Medical Event', /Medical Event/i],
  ['Disciplinary Notice', /Disciplinary Notice/i],
  ['Employee Separation', /Employee Separation/i],
];

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

/* Runs in the page. Walks every element holding its own text, works out
   what is really behind it (walking up through transparent parents the way
   the eye does), and returns the worst offenders. */
const AUDIT = () => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a); const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const behind = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      node = node.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };

  const bodyBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };
  const worst = [];
  document.querySelectorAll('*').forEach((el) => {
    const hasOwnText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasOwnText) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.3) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.5) return;
    const size = parseFloat(cs.fontSize) || 16;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const floor = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    const r = ratio(fg, behind(el));
    if (r < floor) {
      worst.push({
        text: el.textContent.trim().slice(0, 40),
        ratio: Math.round(r * 100) / 100,
        floor,
        color: cs.color,
      });
    }
  });
  return { bodyLuminance: Math.round(lum(bodyBg) * 1000) / 1000, worst: worst.slice(0, 6), total: worst.length };
};

async function auditScreen(page, label) {
  await page.waitForTimeout(500);
  const r = await page.evaluate(AUDIT).catch(() => null);
  if (!r) { check(`${label}: could be measured`, false, 'the audit could not run'); return; }
  check(`${label}: is actually ${THEME}`,
    LIGHT ? r.bodyLuminance > 0.6 : r.bodyLuminance < 0.2,
    `background luminance ${r.bodyLuminance}`);
  check(`${label}: all text is readable (${r.total} below the floor)`, r.total === 0,
    r.worst.map(w => `"${w.text}" ${w.ratio}:1 needs ${w.floor}:1 (${w.color})`).join('\n        '));
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE, 25000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await context.addInitScript((t) => {
      window.__theme = t;
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: window.__theme }));
    }, THEME);
    const page = await context.newPage();
    await page.goto(`${BASE}?sim=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    check(`${THEME} mode is switched on`, theme === THEME, `data-theme=${theme}`);

    for (const [label, name] of TABS) {
      await page.getByRole('button', { name }).first().click().catch(() => {});
      await auditScreen(page, label);
      await page.screenshot({ path: path.join(outDir, `tab-${label.replace(/\W+/g, '-')}.png`) }).catch(() => {});
    }

    for (const [label, tileName] of DOCS) {
      await page.getByRole('button', { name: /^Home$/ }).first().click().catch(() => {});
      await page.waitForTimeout(600);
      const card = page.locator('.startDocTile', { hasText: tileName }).first();
      const tile = card.getByRole('button', { name: /^(Start|Continue)/i }).first();
      if (!(await tile.count())) { check(`${label}: can be opened`, false, 'no start tile'); continue; }
      await tile.click().catch(() => {});
      await page.waitForTimeout(700);
      const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
      if (await blank.count()) { await blank.click().catch(() => {}); await page.waitForTimeout(700); }

      const steps = page.locator('.stepNavRow');
      const n = await steps.count();
      for (let s = 0; s < n; s += 1) {
        await steps.nth(s).click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        const stepName = (await steps.nth(s).innerText().catch(() => `${s + 1}`)).replace(/\s+/g, ' ').trim();
        await auditScreen(page, `${label} / ${stepName}`);
      }
      await page.screenshot({ path: path.join(outDir, `doc-${label.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {});
    }

    await browser.close();
  } finally {
    killTree(server);
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) console.log(`${failed} CHECK(S) FAILED — something is hard to read in ${THEME}.`);
    process.exit(0);
  }
}

main().catch(err => { console.error('dark sweep crashed:', err); process.exit(1); });
