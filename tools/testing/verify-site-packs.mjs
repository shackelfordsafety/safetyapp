// "What kind of site is this?" -> the right extra hazards and controls.
//
// Checks the whole chain on a real browser, because the value of this
// feature is entirely in whether a superintendent who taps Railroad
// actually SEES track hazards two screens later.
//
// Usage: node tools/testing/verify-site-packs.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'sitepacks');
mkdirSync(outDir, { recursive: true });

const PORT = 4362;
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

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(`http://localhost:${PORT}`, 20000);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: /Job Safety Analysis|Start/i }).first().click();
    await page.waitForTimeout(400);
    const blank = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
    if (await blank.count()) { await blank.click(); await page.waitForTimeout(600); }

    // The picker exists, and "Open site" is the default so nothing changes
    // for anybody who ignores it.
    const choices = await page.locator('.siteTypeChoice').count();
    check('the site-type picker is on Job Info with all six choices', choices === 6, `${choices} choices`);
    const openActive = await page.locator('.siteTypeChoice.active strong').first().innerText().catch(() => '');
    check('"Open site" is selected by default — doing nothing changes nothing',
      /Open site/i.test(openActive), `default: ${JSON.stringify(openActive)}`);
    const noteBefore = await page.locator('.siteTypeNote').count();
    check('no pack note shown for an open site', noteBefore === 0);

    await page.getByRole('radio', { name: /Railroad/i }).first().click();
    await page.waitForTimeout(300);
    const note = await page.locator('.siteTypeNote').first().innerText();
    check('picking Railroad says what it did, and that nothing was added',
      /10 hazards and 10 controls/i.test(note) && /Nothing is added/i.test(note),
      note.replace(/\n/g, ' | '));
    check('the note names the regulation, so a super knows whose rules these are',
      /49 CFR Part 214/.test(note));
    await page.screenshot({ path: path.join(outDir, '01-job-rail.png'), fullPage: true });

    // Two screens later: are the track hazards actually in the picker?
    await page.locator('.stepNavRow', { hasText: 'Tasks / Hazards' }).first().click();
    await page.waitForTimeout(500);

    const cats = await page.locator('.quickField select').nth(1).locator('option').allInnerTexts();
    check('a "Railroad — hazards" category appears in the hazard picker',
      cats.some(c => /Railroad\s+—\s+hazards/.test(c)), cats.slice(0, 4).join(' / '));
    check('it sits above the general hazard groups',
      cats.findIndex(c => /Railroad/.test(c)) < cats.findIndex(c => /People/.test(c)),
      `rail at ${cats.findIndex(c => /Railroad/.test(c))}, general at ${cats.findIndex(c => /People/.test(c))}`);

    await page.locator('.quickField select').nth(1).selectOption({ label: cats.find(c => /Railroad/.test(c)) });
    await page.waitForTimeout(300);
    // Scoped to the HAZARD panel. There are three quick panels on this
    // screen (task, hazards, controls) and an unscoped .chipGroup selector
    // silently reads all three, which made the counts below meaningless.
    const chips = await page.locator('.quickPanel').nth(1).locator('.chipGroup .chip span').allInnerTexts();
    check('the real kept lines are there, as short chips',
      chips.includes('Fouling the track') && chips.includes('No contact with the RWIC'),
      `${chips.length} chips, longest ${Math.max(...chips.map(c => c.length))} chars`);
    check('nothing Fonzo cut came back',
      !chips.some(c => /pile|module|Part 46 site-specific/i.test(c)),
      chips.filter(c => /pile|module/i.test(c)).join(', ') || 'none');
    await page.screenshot({ path: path.join(outDir, '02-hazard-picker.png'), fullPage: true });

    // Solar is the pack he cut hardest — make sure it shrank.
    await page.locator('.stepNavRow', { hasText: 'Job Info' }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('radio', { name: /Solar farm/i }).first().click();
    await page.waitForTimeout(300);
    const solarNote = await page.locator('.siteTypeNote').first().innerText();
    check('solar shrank to the civil scope only', /5 hazards and 6 controls/i.test(solarNote),
      solarNote.split('\n')[0]);

    check('no console errors', errors.length === 0, errors.join('\n'));
    await browser.close();
  } finally {
    killTree(server.pid);
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
