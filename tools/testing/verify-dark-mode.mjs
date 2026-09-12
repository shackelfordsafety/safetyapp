// Dark mode, looked at and measured.
//
// It was still the old navy system, so this does two jobs: shoot the real
// screens so the look can be judged, and check that no navy survived
// anywhere -- a single leftover blue token is exactly the kind of thing
// that reads fine in one screenshot and wrong on the screen next to it.
//
// It also computes real contrast ratios. This app gets used outdoors by
// men in their fifties; "looks nice on my monitor" is not the bar.
//
// Usage: node tools/testing/verify-dark-mode.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'darkmode');
mkdirSync(outDir, { recursive: true });

const PORT = 4333;
const BASE_URL = `http://localhost:${PORT}`;
const draftJson = readFileSync(path.join(__dirname, 'fixtures', 'jsa-medical-address.json'), 'utf8');

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

/* WCAG relative luminance + contrast ratio, so the numbers below are the
   real thing rather than a vibe. */
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function parse(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  return [parts[0], parts[1], parts[2]];
}

/* Anything meaningfully blue is a navy leftover. Red and neutral grey are
   the only things that belong on screen. */
function isBluish([r, g, b]) {
  return b > r + 18 && b > g + 10;
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(BASE_URL, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addInitScript((json) => {
      window.localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: 'dark' }));
      window.localStorage.setItem('sdc.jsa.draft.v4', json);
    }, draftJson);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('Theme applied:', theme);

    await page.screenshot({ path: path.join(outDir, 'home.png'), fullPage: true });

    for (const label of ['Documents', 'Templates', 'Settings']) {
      await page.getByRole('button', { name: label, exact: true }).first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outDir, `${label.toLowerCase()}.png`), fullPage: true });
    }

    // Into the JSA itself -- the screen that actually gets used.
    await page.getByRole('button', { name: 'Home' }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Continue JSA' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, 'jsa-job-info.png'), fullPage: true });

    await page.getByRole('tab').last().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, 'jsa-finish.png'), fullPage: true });

    /* Sweep every rendered element for a leftover blue, and measure the
       contrast of body text and muted text against what they sit on. */
    const audit = await page.evaluate(() => {
      const out = { blues: [], samples: [] };
      const seen = new Set();
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        [['color', cs.color], ['background-color', cs.backgroundColor], ['border-color', cs.borderTopColor]]
          .forEach(([prop, val]) => {
            const key = `${prop}:${val}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.blues.push({ prop, val, tag: el.tagName.toLowerCase(), cls: el.className?.toString?.().slice(0, 40) });
          });
      });
      /* Walk the real background stack rather than assuming the parent
         paints one -- most of these sit on a transparent wrapper inside a
         card, and reading the wrapper gives rgba(0,0,0,0) and a nonsense
         ratio. */
      const rgbaOf = (css) => {
        const m = String(css).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(s => parseFloat(s.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };

      /* Composites the whole stack instead of stopping at the first
         non-transparent layer. Half-opaque white on a dark card is a
         mid-grey, not white -- reading it as white reported 1:1 and sent
         me chasing a contrast bug that did not exist. */
      const effectiveBg = (el) => {
        const layers = [];
        let node = el;
        while (node && node !== document.documentElement) {
          const c = rgbaOf(getComputedStyle(node).backgroundColor);
          if (c && c.a > 0) {
            layers.push(c);
            if (c.a === 1) break;
          }
          node = node.parentElement;
        }
        const base = rgbaOf(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
        if (!layers.length || layers[layers.length - 1].a < 1) layers.push(base);
        // Bottom-most upwards, each layer painted over the one below it.
        let out = layers.pop();
        while (layers.length) {
          const top = layers.pop();
          out = {
            r: top.r * top.a + out.r * (1 - top.a),
            g: top.g * top.a + out.g * (1 - top.a),
            b: top.b * top.a + out.b * (1 - top.a),
            a: 1,
          };
        }
        return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
      };

      /* Every distinct piece of text actually on screen, not a hand-picked
         three. The first version of this check sampled body text, helper
         text and the primary button, all of which passed -- while "Start a
         JSA" and the tile icons were rendering near-black on a near-black
         card, because they were painted with the fixed brand colour
         instead of a theme one. A sample that only looks where you already
         expect trouble is not an audit. */
      const seenText = new Set();
      document.querySelectorAll('a, button, h1, h2, h3, p, span, strong, li, label').forEach((el) => {
        const text = (el.textContent || '').trim();
        if (!text || text.length > 60) return;
        if (el.querySelector('a, button, h1, h2, h3, p, span, strong, li, label')) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) return;
        const box = el.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) return;
        const key = `${cs.color}|${effectiveBg(el)}`;
        if (seenText.has(key)) return;
        seenText.add(key);
        out.samples.push({
          what: text.slice(0, 34),
          fg: cs.color,
          bg: effectiveBg(el),
          size: parseFloat(cs.fontSize),
          weight: cs.fontWeight,
        });
      });
      return out;
    });

    const blues = audit.blues
      .map(b => ({ ...b, rgb: parse(b.val) }))
      .filter(b => b.rgb && isBluish(b.rgb) && !/rgba\(0, 0, 0, 0\)/.test(b.val));

    console.log('\nBlue/navy values still rendering:', blues.length);
    blues.slice(0, 12).forEach(b => console.log(`   ${b.val}  (${b.prop} on ${b.tag}.${b.cls})`));

    /* WCAG AA: 4.5:1 for normal text, 3:1 once it is 18.66px+ bold or
       24px+ regular. Applied per element rather than as one blanket
       number, so a big heading isn't failed for being big. */
    const scored = audit.samples.map((s) => {
      const fg = parse(s.fg); const bg = parse(s.bg);
      if (!fg || !bg) return null;
      const large = s.size >= 24 || (s.size >= 18.66 && Number(s.weight) >= 700);
      const need = large ? 3 : 4.5;
      return { ...s, r: ratio(fg, bg), need, large };
    }).filter(Boolean);

    const failures = scored.filter(s => s.r < s.need).sort((a, b) => a.r - b.r);
    console.log(`\nContrast checked on ${scored.length} distinct text/background pairs.`);
    if (failures.length === 0) {
      console.log('   every one clears WCAG AA.');
    } else {
      console.log(`   ${failures.length} BELOW AA:`);
      failures.forEach(f => console.log(`     ${f.r.toFixed(2)}:1 (needs ${f.need})  "${f.what}"  ${f.fg} on ${f.bg}`));
    }
    const worst = scored.filter(s => s.r >= s.need).sort((a, b) => a.r - b.r)[0];
    if (worst) console.log(`   tightest passing: ${worst.r.toFixed(2)}:1  "${worst.what}"`);

    console.log('\nPage errors:', errors.length ? errors : 'none');
    await browser.close();
    process.exitCode = blues.length === 0 && errors.length === 0 && failures.length === 0 ? 0 : 1;
  } finally {
    killTree(server.pid);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
