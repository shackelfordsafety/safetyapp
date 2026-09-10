// The six things the outside tester found, checked one at a time on a real
// browser against the real built app. No fixture draft for most of them --
// the whole point of half these findings is what a BLANK app tells you.
//
// Usage: node tools/testing/verify-tester-punchlist.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'punchlist');
mkdirSync(outDir, { recursive: true });

const PORT = 4358;
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
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
    const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // 3. Fresh guest empty state
    const emptyText = await page.locator('.homeEmptyText').first().innerText();
    check('3. fresh guest empty state does not claim past work',
      !/Everything you started/i.test(emptyText) && /Nothing to finish/i.test(emptyText),
      emptyText.replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(outDir, '01-home-fresh.png') });

    // Start a blank JSA
    await page.getByRole('button', { name: /Job Safety Analysis|Start/i }).first().click();
    await page.waitForTimeout(400);
    const blankBtn = page.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
    if (await blankBtn.count()) { await blankBtn.click(); await page.waitForTimeout(600); }

    // 2. Missing items surface on the step itself
    const missingVisible = await page.locator('.stepMissing').first().isVisible().catch(() => false);
    const missingText = missingVisible ? await page.locator('.stepMissing').first().innerText() : '';
    check('2. Job Info names what is missing on the screen itself',
      missingVisible && /Muster point/i.test(missingText), missingText.replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(outDir, '02-job-missing.png'), fullPage: true });

    // 1. Finish reads Locked, and Next cannot walk into it
    const finishRow = page.locator('.stepNavRow', { hasText: 'Finish' }).first();
    const finishState = await finishRow.innerText().catch(() => '');
    const finishAria = await finishRow.getAttribute('aria-label').catch(() => '');
    const finishClass = await finishRow.getAttribute('class').catch(() => '');
    check('1a. Finish reads Locked in words, not just a dimmed padlock',
      /Locked/i.test(finishState) && /Locked/i.test(finishAria || '') && /\blocked\b/.test(finishClass || ''),
      `visible: ${JSON.stringify(finishState)}  aria: ${JSON.stringify(finishAria)}  class: ${JSON.stringify(finishClass)}`);

    // Walk Next three times; it must never land on Finish while empty.
    let landedOnFinish = false;
    for (let i = 0; i < 3; i += 1) {
      const nextBtn = page.getByRole('button', { name: /^Next$|Ready for Crew to Sign|^Next:/ }).first();
      if (!(await nextBtn.count())) break;
      await nextBtn.click();
      await page.waitForTimeout(350);
      const heading = await page.locator('.stepPanelHeader h3').first().innerText().catch(() => '');
      if (/^Finish$/i.test(heading.trim())) landedOnFinish = true;
    }
    check('1b. Next never opens Finish while the JSA is empty', !landedOnFinish,
      landedOnFinish ? 'Next walked straight into the locked step' : 'redirected to the incomplete step every time');

    // 4. Previous day is blank, not pre-filled
    await page.locator('.stepNavRow', { hasText: 'Meeting Info' }).first().click();
    await page.waitForTimeout(400);
    const prevDay = page.locator('textarea').nth(1);
    const prevVal = await prevDay.inputValue().catch(() => '<not found>');
    check('4. previous day is blank, not "None reported."', prevVal === '',
      `field value: ${JSON.stringify(prevVal)}`);
    await page.screenshot({ path: path.join(outDir, '03-meeting.png'), fullPage: true });

    // 5. Saved says where
    const savedText = await page.locator('.builderHeaderSaved').first().innerText().catch(() => '');
    check('5. saved status says where it saved',
      /this device/i.test(savedText) || /Not saved yet/i.test(savedText), savedText);

    check('no console errors', errors.length === 0, errors.join('\n'));

    /* The sticky action bar only exists on touch, and its status text is
       nowrap + ellipsis in a narrow centre column. "Saved on this device"
       is longer than the "Saved" it replaced, so measure whether it
       actually fits on the real field device rather than assuming. */
    const ipad = await browser.newContext({ viewport: { width: 834, height: 1112 }, hasTouch: true, isMobile: true });
    const p2 = await ipad.newPage();
    await p2.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(600);
    await p2.getByRole('button', { name: /Job Safety Analysis|Start/i }).first().click();
    await p2.waitForTimeout(400);
    const blank2 = p2.getByRole('button', { name: /Start Blank|Blank JSA/i }).first();
    if (await blank2.count()) { await blank2.click(); await p2.waitForTimeout(600); }
    await p2.locator('.stepPanel input[type="text"], .stepPanel input:not([type])').first().fill('Test Site');
    await p2.waitForTimeout(2200);
    const bar = await p2.locator('.stickyActionStatus').first()
      .evaluate(el => ({ text: el.innerText, scrollW: el.scrollWidth, clientW: el.clientWidth }))
      .catch(() => null);
    check('5b. "Saved on this device" fits the sticky bar on an iPad',
      !!bar && bar.scrollW <= bar.clientW,
      bar ? `"${bar.text}" — needs ${bar.scrollW}px, has ${bar.clientW}px` : 'sticky bar not found');
    const missTouch = await p2.locator('.stepMissing').first().isVisible().catch(() => false);
    check('2b. "Still needed" also shows on touch, where StepFooter does not', missTouch);
    await p2.screenshot({ path: path.join(outDir, '04-ipad.png'), fullPage: true });

    await browser.close();
  } finally {
    killTree(server.pid);
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
