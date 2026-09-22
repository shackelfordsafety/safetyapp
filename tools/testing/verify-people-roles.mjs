// Settings > People: can somebody who is allowed to, change a role -- and
// is everybody else kept out?
//
// The card talks to Supabase, so the archiveClient chunk is stubbed at the
// network layer (the same trick the retired verify-job-picker.mjs used on
// jobsStore). That keeps this runnable with no account and no database,
// and it is honest about what it does and does not prove:
//
//   PROVES: the screen appears only for the right roles, the two rules that
//   matter are visible rather than discovered by error (you cannot change
//   your own role; only an owner can change an owner), the picker explains
//   what each role means, and Save sends exactly one set_person_role call
//   with the right arguments.
//
//   DOES NOT PROVE: that the database accepts it. That is enforced by
//   set_person_role() re-checking everything server-side, and it holds with
//   or without this screen.
//
// Usage: node tools/testing/verify-people-roles.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const outDir = path.join(HERE, 'output', 'people-roles');
const PORT = 4327;
const BASE = `http://localhost:${PORT}/`;

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed });
  console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const PEOPLE = [
  { id: 'u-me-hr',   full_name: 'Pat Foster',        role: 'hr',      is_admin: false },
  { id: 'u-owner',   full_name: 'Hunter Shackelford', role: 'owner',   is_admin: false },
  { id: 'u-admin',   full_name: 'Alfonso Hernandez',  role: 'safety',  is_admin: true  },
  { id: 'u-foreman', full_name: 'Jake Lytle',         role: 'foreman', is_admin: false },
  { id: 'u-noname',  full_name: null,                 role: 'pm',      is_admin: false },
];

/* A stub `db` with just the surface PeopleCard touches. Every rpc call is
   recorded on window so the test can assert what was sent. */
function stubFor(meId) {
  return `
    const PEOPLE = ${JSON.stringify(PEOPLE)};
    window.__rpc = [];
    function table(name) {
      const api = {
        select() { return api; },
        order() { return api; },
        limit() { return api; },
        then(res) {
          const data = name === 'profiles' ? PEOPLE : [];
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return api;
    }
    export const db = {
      auth: { getUser: async () => ({ data: { user: { id: '${meId}' } } }) },
      from: table,
      rpc: async (fn, args) => { window.__rpc.push({ fn, args }); return { data: null, error: null }; },
    };
    export const SUPABASE_URL = 'https://example.invalid';
  `;
}

async function openSettingsAs(context, meId, email) {
  await context.addInitScript(e => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { email: e, id: 'x' } }));
  }, email);
  await context.route(/\/assets\/archiveClient-.*\.js$/, r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: stubFor(meId),
  }));
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  await page.waitForTimeout(1200);
  return page;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 5000));

  const browser = await chromium.launch();
  try {
    // ── 1. HR: the card is there, and the rules are visible ──────────────
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 1100 }, hasTouch: true });
      const page = await openSettingsAs(context, 'u-me-hr', 'pat@example.com');

      const rows = page.locator('.peopleRow');
      check('HR sees the People card', (await rows.count()) === PEOPLE.length,
        `${await rows.count()} rows`);

      const meRow = rows.filter({ hasText: 'Pat Foster' });
      check('you cannot change your own role, and it says so',
        (await meRow.locator('.peopleLocked').count()) === 1,
        (await meRow.locator('.peopleLocked').innerText().catch(() => '')).trim());

      const ownerRow = rows.filter({ hasText: 'Hunter Shackelford' });
      check('HR cannot change an owner, and it says so',
        (await ownerRow.locator('.peopleLocked').count()) === 1,
        (await ownerRow.locator('.peopleLocked').innerText().catch(() => '')).trim());

      const foremanRow = rows.filter({ hasText: 'Jake Lytle' });
      check('an ordinary person is editable',
        (await foremanRow.locator('select').count()) === 1);

      const ownerOpt = await foremanRow.locator('select').evaluate(sel => {
        const o = sel.querySelector('option[value="owner"]');
        return o ? { disabled: o.disabled, attr: o.getAttribute('disabled') } : null;
      });
      check('HR is not offered the owner role', ownerOpt?.disabled === true,
        JSON.stringify(ownerOpt));

      check('a person with no name still shows up',
        (await rows.filter({ hasText: 'Name not set yet' }).count()) === 1);

      check('the admin account is marked',
        (await rows.filter({ hasText: 'Alfonso Hernandez' }).locator('.peopleTag').count()) === 1);

      // The picker has to explain itself, or somebody guesses wrong.
      await foremanRow.locator('select').selectOption('clerk');
      await page.waitForTimeout(200);
      const meaning = await foremanRow.locator('.helperText').first().innerText();
      check('the picker says what the role means',
        /every filed document/i.test(meaning), JSON.stringify(meaning));

      await foremanRow.getByRole('button', { name: /Save role/i }).click();
      await page.waitForTimeout(600);
      const sent = await page.evaluate(() => window.__rpc);
      check('Save sends exactly one set_person_role, with the right arguments',
        sent.length === 1 && sent[0].fn === 'set_person_role'
          && sent[0].args?.target === 'u-foreman' && sent[0].args?.new_role === 'clerk',
        JSON.stringify(sent));

      await page.locator('.card', { hasText: 'People' }).first()
        .screenshot({ path: path.join(outDir, 'people-hr.png') });
      await context.close();
    }

    // ── 2. An owner can change an owner ──────────────────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 1100 }, hasTouch: true });
      const page = await openSettingsAs(context, 'u-owner', 'hunter@example.com');
      const otherOwnerRow = page.locator('.peopleRow').filter({ hasText: 'Alfonso Hernandez' });
      /* Read the option's own `disabled` property, NOT Playwright's
         isDisabled(). isDisabled() reports false for an <option> whatever
         its state, so the obvious version of this assertion passes whether
         the rule works or not -- it did, and it was hiding the fact that
         the HR case below was the only one really being tested. */
      const opt = await otherOwnerRow.locator('select').evaluate(sel => {
        const o = sel.querySelector('option[value="owner"]');
        return o ? o.disabled : null;
      });
      check('an owner IS offered the owner role', opt === false, `disabled=${opt}`);
      await context.close();
    }

    // ── 3. Everybody else never sees it ──────────────────────────────────
    for (const [who, id] of [['a foreman', 'u-foreman'], ['a PM', 'u-noname']]) {
      const context = await browser.newContext({ viewport: { width: 1180, height: 1100 }, hasTouch: true });
      const page = await openSettingsAs(context, id, 'someone@example.com');
      check(`${who} never sees the People card`,
        (await page.locator('.peopleRow').count()) === 0);
      await context.close();
    }

    const failed = results.filter(r => !r.passed).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exitCode = failed ? 1 : 0;
  } catch (err) {
    console.error('\n!! FAILED: ' + (err?.message || err));
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    killTree(server);
    console.log(`\noutput in ${outDir}`);
  }
}

main().catch(e => { console.error('crashed:', e); process.exit(1); });
