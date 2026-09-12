// Regression coverage for speech-to-text (Milestone 2 of the zero-training
// UX mission). `SpeechRecognition` is mocked entirely -- there is no real
// microphone or network speech service in headless Chromium, so this
// verifies component/state behavior (button presence, feature-detection
// fallback, append algorithm, error handling, autosave interplay), NOT real
// recognition accuracy. Physical-device verification (iPhone Safari, iPad
// Safari, Windows Edge/Chrome with a real mic) is a separate, manual step --
// see the mission's Definition of Done. Run standalone:
//   node tools/testing/verify-voice-input.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'voice-input');
mkdirSync(outDir, { recursive: true });

const PORT = 4360;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Server at ${url} did not become ready in time`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label}`); failures++; }
}

// A fake SpeechRecognition: start() schedules an interim then a final
// onresult with a known phrase; erroringStart() fires onerror instead.
const MOCK_OK = `
class MockSpeechRecognition {
  constructor() { this.continuous = false; this.interimResults = false; }
  start() {
    setTimeout(() => { if (this.onresult) this.onresult({ results: [{ 0: { transcript: 'ladder was placed near the trench' }, isFinal: false, length: 1 }], length: 1 }); }, 40);
    setTimeout(() => {
      if (this.onresult) this.onresult({ results: [{ 0: { transcript: 'ladder was placed near the trench edge.' }, isFinal: true, length: 1 }], length: 1 });
      if (this.onend) this.onend();
    }, 120);
  }
  stop() { if (this.onend) this.onend(); }
}
window.SpeechRecognition = MockSpeechRecognition;
window.webkitSpeechRecognition = MockSpeechRecognition;
`;

const MOCK_DENIED = `
class MockSpeechRecognitionDenied {
  start() { setTimeout(() => { if (this.onerror) this.onerror({ error: 'not-allowed' }); }, 40); }
  stop() {}
}
window.SpeechRecognition = MockSpeechRecognitionDenied;
window.webkitSpeechRecognition = MockSpeechRecognitionDenied;
`;

async function main() {
  console.log('[1/6] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/6] Preview server ready at', BASE_URL);
    const browser = await chromium.launch();

    // ── 1. Mic button on audited fields, absent on short/structured fields ──
    console.log('\n=== 1. Mic present only on audited narrative fields ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(MOCK_OK);
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('dialog', d => d.accept());

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Start JSA' }).click();
      await page.waitForTimeout(200);

      // Job Info step: short Field()s only, no mic anywhere.
      const jobStepMics = await page.locator('.voiceBtn').count();
      check(jobStepMics === 0, 'No mic buttons on Job Info step (short fields only)');

      await page.getByRole('tab', { name: /Meeting Info/ }).click();
      await page.waitForTimeout(150);
      check(await page.getByRole('button', { name: 'Dictate this field' }).count() === 3, 'Meeting Info: exactly 3 mic buttons (Tailgate Topic, Previous Day, Overall Task)');

      // Incident: detailedIncidentDescription gets a mic, short Field()s don't.
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Start Incident Report' }).click();
      await page.waitForTimeout(200);
      check(await page.locator('label.field', { hasText: 'Detailed description of the incident' }).locator('.voiceBtn').count() === 1, 'Incident: mic present on Detailed Description');
      check(await page.locator('label.field', { hasText: 'Workplace location' }).locator('.voiceBtn').count() === 0, 'Incident: no mic on Workplace location (short field)');

      // Disciplinary: all 7 narrative fields get mics, short fields don't.
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Documents', exact: false }).first().click();
      await page.locator('.listItem', { hasText: 'Employee Disciplinary Notice' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForSelector('text=Notice Details');
      /* Three, not four. Section 4 (Employee Statement) was removed on
         2026-08-29 -- the employee writes that by hand on the printed
         copy, so there is no field here to dictate into. */
      check(await page.getByRole('button', { name: 'Dictate this field' }).count() === 3, 'Disciplinary Notice Details: 3 mic buttons (sections 1-3)');
      check(await page.locator('label.field', { hasText: 'Employee Name' }).locator('.voiceBtn').count() === 0, 'Disciplinary: no mic on Employee Name (short field)');

      await context.close();
    }

    // ── 2. Unsupported browser: no button, quiet hint instead ──
    console.log('\n=== 2. Unsupported browser shows a hint, never a broken button ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      // No SpeechRecognition mock installed -- but the app runs under real
      // Chromium, which DOES support it natively, so explicitly delete it to
      // simulate Safari's actual lack of support.
      await context.addInitScript(() => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('dialog', d => d.accept());
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Start JSA' }).click();
      await page.getByRole('tab', { name: /Meeting Info/ }).click();
      await page.waitForTimeout(150);
      check(await page.locator('.voiceBtn').count() === 0, 'No mic buttons rendered when SpeechRecognition is unsupported');
      check(await page.locator('.voiceHint').count() >= 1, 'Keyboard-dictation hint shown in place of the button');
      const hintText = await page.locator('.voiceHint').first().innerText();
      check(/keyboard/i.test(hintText), `Hint mentions the keyboard mic (got: "${hintText}")`);
      // The field itself must remain fully usable without voice.
      const ta = page.locator('label.field', { hasText: 'Tailgate Safety Topic' }).locator('textarea');
      await ta.fill('Typed manually, no voice available.');
      check(await ta.inputValue() === 'Typed manually, no voice available.', 'Textarea still fully typeable when voice is unsupported');
      await context.close();
    }

    // ── 3. Transcript insert (empty) + append (non-empty), no duplication ──
    console.log('\n=== 3. Insert into empty field, append to existing, no collisions ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(MOCK_OK);
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('dialog', d => d.accept());
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Start JSA' }).click();
      await page.getByRole('tab', { name: /Meeting Info/ }).click();
      await page.waitForTimeout(150);

      const ta = page.locator('label.field', { hasText: 'Tailgate Safety Topic' }).locator('textarea');
      const micBtn = page.locator('label.field', { hasText: 'Tailgate Safety Topic' }).getByRole('button', { name: 'Dictate this field' });

      // Empty field -> verbatim insert.
      await micBtn.click();
      await page.waitForTimeout(250);
      let val = await ta.inputValue();
      check(val === 'ladder was placed near the trench edge.', `Empty field gets transcript verbatim (got: "${val}")`);

      // Non-empty field -> clean append, no collision, no duplication.
      await ta.fill('Existing topic.');
      await micBtn.click();
      await page.waitForTimeout(250);
      val = await ta.inputValue();
      check(val === 'Existing topic. ladder was placed near the trench edge.', `Appends with a single space, no collision (got: "${val}")`);
      check(!/(edge\.).*\1/.test(val), 'No duplicated transcript from interim+final events');

      // Type more, speak again -- still clean.
      await ta.fill(val + ' typed more.');
      await micBtn.click();
      await page.waitForTimeout(250);
      val = await ta.inputValue();
      check(val.includes('typed more.') && val.split('ladder was placed near the trench edge.').length === 3, `Type -> speak -> type -> speak all preserved, no loss (got: "${val}")`);

      check(pageErrors.length === 0, `No uncaught page errors (${pageErrors.length})`);
      await context.close();
    }

    // ── 4. Permission denied: field stays usable, plain-English message ──
    console.log('\n=== 4. Permission denied never breaks the field ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(MOCK_DENIED);
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('dialog', d => d.accept());
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Start JSA' }).click();
      await page.getByRole('tab', { name: /Meeting Info/ }).click();
      await page.waitForTimeout(150);

      const ta = page.locator('label.field', { hasText: 'Tailgate Safety Topic' }).locator('textarea');
      const micBtn = page.locator('label.field', { hasText: 'Tailgate Safety Topic' }).getByRole('button', { name: 'Dictate this field' });
      await micBtn.click();
      await page.waitForTimeout(200);
      const errText = await page.locator('.voiceError').first().innerText();
      check(/microphone/i.test(errText) && !/not-allowed/i.test(errText), `Plain-English error, no raw API error code (got: "${errText}")`);
      check(await ta.isEnabled(), 'Textarea remains enabled after permission denial');
      await ta.fill('Typing still works after denial.');
      check(await ta.inputValue() === 'Typing still works after denial.', 'Typing still works after a denied permission');
      await context.close();
    }

    // ── 5. Autosave still fires after a voice-inserted change ──
    console.log('\n=== 5. Autosave persists a voice-inserted change ===');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(MOCK_OK);
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('dialog', d => d.accept());
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.homeLayout');
      await page.getByRole('button', { name: 'Start JSA' }).click();
      await page.getByRole('tab', { name: /Meeting Info/ }).click();
      await page.waitForTimeout(150);
      const micBtn = page.locator('label.field', { hasText: 'Tailgate Safety Topic' }).getByRole('button', { name: 'Dictate this field' });
      await micBtn.click();
      await page.waitForTimeout(1300); // past the 900ms autosave debounce
      const saved = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('sdc.jsa.draft.v4') || 'null'); } catch { return null; }
      });
      check(saved?.tailgateTopic === 'ladder was placed near the trench edge.', `Voice-inserted text autosaved to localStorage (got: ${JSON.stringify(saved?.tailgateTopic)})`);
      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server);
  }

  console.log(`\n[6/6] Done. ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) {
    console.log('--- preview server output (tail) ---');
    console.log(serverOutput.slice(-2000));
    process.exit(1);
  }
}

main().then(() => {
  // Explicit success exit: the spawned 'vite preview' grandchild keeps Node's
  // event loop alive on Windows even after server.kill(), so a PASSING run
  // would otherwise hang until the caller's timeout instead of finishing.
  process.exit(0);
}).catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
