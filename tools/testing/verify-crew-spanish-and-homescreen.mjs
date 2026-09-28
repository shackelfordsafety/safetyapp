// The crew page in Spanish, and the Add to Home Screen card.
//
//   node tools/testing/verify-crew-spanish-and-homescreen.mjs [outDir]
//
// Fonzo, 2026-09-28: "an add to homescreen button would be killer" and
// "a possible translate to spanish setting for our hispanic brothers and
// sisters". The board's answers are faked at the network layer (board_for),
// same as verify-jsa-signing-window.mjs.
//
// Checks, on an iPhone and an Android phone:
//   - English by default; the Español button switches every app word
//   - the choice is remembered on reload
//   - a phone set to Spanish opens in Spanish the first time
//   - what the super TYPED (tasks/hazards) is shown as written
//   - the standard acknowledgement shows in Spanish WITH the English under it
//   - Add to Home Screen shows the right 3 steps for iPhone vs Android,
//     "Not now" hides it and it stays hidden

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || path.join(__dirname, 'output', 'crew-spanish');
mkdirSync(outDir, { recursive: true });

const PORT = 4489;
const BASE = `http://localhost:${PORT}`;
const REF = 'adqhuueugwbbudekpkiw';
const OWNER = '00000000-0000-4000-8000-000000000001';
const ACK = 'I have reviewed and understand the conditions of this JSA and its attached plans and will comply. I will report hazardous conditions or acts identified on this job site to my supervisor and/or Shackelford representative so they can be corrected if necessary. I will conduct a last minute risk assessment before each task and will exercise stop work authority for any unsafe act, condition, or hazard.';

const pad = n => String(n).padStart(2, '0');
const start = new Date(Date.now() - 3600000);
const end = new Date(Date.now() + 7 * 3600000);
const day = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
const ROWS = [{
  id: '00000000-0000-4000-8000-0000000000c1', area_label: 'East gen pad — Entergy TAPS', job_site: 'Entergy TAPS',
  location: 'Ridgeland, MS', job_number: '480-02', doc_date: day, published_at: start.toISOString(),
  expires_at: end.toISOString(), version: 1, pdf_path: null, client_doc_id: 'x',
  data: {
    date: day, timeIssued: `${pad(start.getHours())}:${pad(start.getMinutes())}`, timeExpired: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    jobSite: 'Entergy TAPS', location: 'Ridgeland, MS', area: 'East gen pad', overallWorkTask: 'MASS GRADING',
    superintendentForeman: 'Gaines Newell', emergencyPhone: '911', nearestMedicalFacility: 'UMMC', nearestMedicalAddress: '2500 N State St, Jackson, MS',
    musterPoint: 'Laydown Yard', tailgateTopic: 'Heat stress',
    taskRows: [
      { step: 'Cut/fill area A', hazards: 'Struck by equipment', controls: 'Maintain eye contact with operator' },
      { step: 'Install rip rap in barrel culverts', hazards: 'Pinch points', controls: 'Use tag lines' },
    ],
    acknowledgement: ACK,
  },
}];

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => fetch(url).then(() => resolve()).catch(() => {
      if (Date.now() > deadline) reject(new Error('server not ready'));
      else setTimeout(tryOnce, 300);
    });
    tryOnce();
  });
}

const results = [];
const check = (ok, msg) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const PHONES = {
  iphone: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  android: { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
};

async function phone(browser, name, locale = 'en-US') {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: PHONES[name].ua, locale,
  });
  await ctx.route(new RegExp(`${REF}\\.supabase\\.co`), route => {
    const url = route.request().url();
    if (url.includes('/rpc/board_for')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}#/sign/${OWNER}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await waitForServer(BASE, 25000);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

  // iPhone, English -> Spanish
  {
    const { ctx, page, errors } = await phone(browser, 'iphone');
    check(await page.getByRole('heading', { name: 'Where are you working?' }).count() === 1, 'English by default');
    const card = page.locator('.a2hs');
    check(await card.count() === 1, 'iPhone: Add to Home Screen card shows');
    await card.getByRole('button', { name: 'Show me how' }).click();
    await page.waitForTimeout(300);
    const steps = await card.locator('.a2hsSteps li').allInnerTexts();
    check(steps.length === 3 && /Share/.test(steps[0]), `iPhone: 3 Share-button steps (${steps[0]?.slice(0, 40)}…)`);
    await page.screenshot({ path: path.join(outDir, 'iphone-1-english-howto.png'), fullPage: true });

    await page.getByRole('button', { name: 'Ver en español' }).first().click();
    await page.waitForTimeout(400);
    check(await page.getByRole('heading', { name: '¿Dónde está trabajando hoy?' }).count() === 1, 'Español switches the page');
    check(await page.locator('.crewTag').first().innerText() === 'ABIERTO' || /abierto/i.test(await page.locator('.crewTag').first().innerText()), `Tag reads "${await page.locator('.crewTag').first().innerText()}"`);
    check(/Toque el botón de Compartir/.test(await page.locator('.a2hsSteps').innerText()), 'Home-screen steps are in Spanish too');
    await page.screenshot({ path: path.join(outDir, 'iphone-2-spanish-list.png'), fullPage: true });

    await page.locator('.crewPick').first().click();
    await page.waitForTimeout(800);
    const body = await page.locator('.jsaDoc').innerText();
    check(/Peligros/i.test(body) && /Controles/i.test(body), 'JSA labels in Spanish (Peligros, Controles)');
    check(/Struck by equipment/.test(body), 'What the super typed is shown as written ("Struck by equipment")');
    check(/He revisado y entiendo/.test(body) && body.includes(ACK.slice(0, 40)), 'Acknowledgement in Spanish, with the English original under it');
    await page.screenshot({ path: path.join(outDir, 'iphone-3-spanish-jsa.png'), fullPage: true });
    await page.getByRole('button', { name: 'Firmar el JSA' }).click();
    await page.waitForTimeout(800);
    check(await page.getByRole('button', { name: 'Terminar' }).count() === 1, 'Signing form in Spanish (Terminar)');
    await page.screenshot({ path: path.join(outDir, 'iphone-4-spanish-sign.png') });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    check(await page.getByRole('heading', { name: '¿Dónde está trabajando hoy?' }).count() === 1, 'Spanish is remembered after reload');
    await page.locator('.a2hs').getByRole('button', { name: 'Ahora no' }).click();
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    check(await page.locator('.a2hs').count() === 0, '"Ahora no" hides the home-screen card, and it stays hidden');
    check(!errors.length, `iPhone: no page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }

  // Android, phone set to Spanish
  {
    const { ctx, page, errors } = await phone(browser, 'android', 'es-US');
    check(await page.getByRole('heading', { name: '¿Dónde está trabajando hoy?' }).count() === 1, 'Android set to Spanish: opens in Spanish the first time');
    await page.locator('.a2hs').getByRole('button', { name: 'Muéstreme cómo' }).click();
    await page.waitForTimeout(300);
    const steps = await page.locator('.a2hsSteps li').allInnerTexts();
    check(steps.length === 3 && /⋮/.test(steps[0]), `Android: Chrome ⋮-menu steps (${steps[0]?.slice(0, 40)}…)`);
    await page.screenshot({ path: path.join(outDir, 'android-1-spanish-howto.png'), fullPage: true });
    check(!errors.length, `Android: no page errors${errors.length ? ` — ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }

  // The app's own Home, on an iPad
  {
    const ctx = await browser.newContext({
      viewport: { width: 1024, height: 1366 }, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
      localStorage.setItem('sdc.settings.v2', JSON.stringify({ theme: 'dark' }));
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check(await page.locator('.a2hs').count() === 1, 'iPad (reports itself as a Mac): card shows on the app Home');
    await page.locator('.a2hs').getByRole('button', { name: 'Show me how' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'ipad-home.png') });
    await ctx.close();
  }
  // Desktop: nothing
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check(await page.locator('.a2hs').count() === 0, 'Desktop computer: no home-screen card');
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  console.error('STOPPED:', err?.message || err);
  results.push(false);
} finally {
  console.log(results.every(Boolean) ? '\nALL PASS' : '\nSOMETHING FAILED');
  killTree(server);
  process.exit(0);
}
