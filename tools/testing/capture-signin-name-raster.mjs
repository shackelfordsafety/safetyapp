// Does a real JSA export still clip the name under a signature?
//
// Fonzo, 2026-09-22, looking at filed JSAs: "the names under the signatures
// are still cut off."
//
// Why this script exists rather than reusing an existing one:
//
//   - verify-signin-names.mjs, the CORE check covering this, renders its PDF
//     with page.pdf() -- Chrome's own print engine. The JSA's real export is
//     an html2canvas screenshot pipeline (pdfExportCore.js). Different
//     renderers, and html2canvas is the one documented here as painting text
//     below where the box says. A check on the wrong renderer passes forever
//     while the real sheet clips.
//
//   - There is no longer a "Create Document" button to drive. Publishing
//     makes no PDF, and the paper route sets signInMode to 'printout', which
//     makes printedCrewSignatures() return [] -- so no names print at all on
//     that path. The PDFs that actually carry names are generated on demand
//     from Today or the Archive, which need a login.
//
// So this drives the renderer directly against the same DOM the real export
// captures: the mounted .pdfExportRoot sign-in page, rendered through the
// app's own html2canvas chunk at the app's own scale (2.5 on desktop, see
// pdfExportCore.js). Same element, same renderer, same options -- the raster
// this produces is what the archive would put in the PDF.
//
// Usage:
//   node tools/testing/capture-signin-name-raster.mjs > out.log 2>&1

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const outDir = path.join(HERE, 'output', 'signin-name-raster');
const PORT = 4321;
const BASE = `http://localhost:${PORT}/`;
const FIXTURE = process.env.FIXTURE || 'jsa-named-signin.json';
const SCALE = 2.5; // matches pdfExportCore.js on a non-touch device

const draftJson = readFileSync(path.join(HERE, 'fixtures', FIXTURE), 'utf8');
JSON.parse(draftJson);

// The app loads html2canvas as a hashed chunk; find whatever this build named it.
const h2cChunk = readdirSync(path.join(ROOT, 'dist', 'assets'))
  .find(f => f.startsWith('html2canvas') && f.endsWith('.js'));
if (!h2cChunk) { console.error('no html2canvas chunk in dist/assets -- run npm run build'); process.exit(1); }

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 5000));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    await context.addInitScript(s => window.localStorage.setItem('sdc.jsa.draft.v4', s), draftJson);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    const cont = page.getByRole('button', { name: /Continue JSA/i }).first();
    if (await cont.count()) { await cont.click(); await page.waitForTimeout(800); }
    await page.getByRole('tab').last().click();
    await page.waitForTimeout(800);

    const domNames = await page.locator('.pdfExportRoot .attachedSigLineName').allInnerTexts();
    console.log(`  names in the export DOM: ${domNames.length}`);
    console.log(`  longest: ${JSON.stringify(domNames.reduce((a, b) => (b.length > a.length ? b : a), ''))}`);

    const result = await page.evaluate(async ({ chunk, scale }) => {
      const mod = await import(`/assets/${chunk}`);
      const html2canvas = mod.default || mod;
      const pageEl = document.querySelector('.pdfExportRoot .printPage.signInPage');
      if (!pageEl) return { error: 'no .signInPage inside .pdfExportRoot' };

      // Exactly the app's own capture options (pdfExportCore.js).
      const canvas = await html2canvas(pageEl, {
        scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
      });

      // Crop to the signature grid so the names are legible when viewed.
      const pr = pageEl.getBoundingClientRect();
      const grid = pageEl.querySelector('.attachedSignatureGrid');
      const gr = grid.getBoundingClientRect();
      const sx = Math.round((gr.left - pr.left) * scale);
      const sy = Math.round((gr.top - pr.top) * scale);
      const sw = Math.round(gr.width * scale);
      const sh = Math.round(Math.min(gr.height, 6 * 55) * scale); // first ~6 rows

      const crop = document.createElement('canvas');
      crop.width = sw; crop.height = sh;
      crop.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      // Where the name boxes sit, for reference against the picture.
      const rows = [...pageEl.querySelectorAll('.attachedSigLine')].slice(0, 6).map(r => {
        const n = r.querySelector('.attachedSigLineName');
        if (!n) return null;
        const nr = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        return {
          text: n.textContent,
          boxH: +nr.height.toFixed(1),
          lineHeight: cs.lineHeight,
          fontSize: cs.fontSize,
          overflow: cs.overflow,
        };
      }).filter(Boolean);

      return { full: canvas.toDataURL('image/png'), crop: crop.toDataURL('image/png'), rows };
    }, { chunk: h2cChunk, scale: SCALE });

    if (result.error) { console.error('  !! ' + result.error); }
    else {
      writeFileSync(path.join(outDir, 'signin-page-full.png'),
        Buffer.from(result.full.split(',')[1], 'base64'));
      writeFileSync(path.join(outDir, 'signin-names-crop.png'),
        Buffer.from(result.crop.split(',')[1], 'base64'));
      console.log('  wrote signin-page-full.png and signin-names-crop.png');
      console.log('  name boxes:');
      for (const r of result.rows) {
        console.log(`    ${JSON.stringify(r.text)}  box=${r.boxH}px  line-height=${r.lineHeight}  font=${r.fontSize}  overflow=${r.overflow}`);
      }
    }

    console.log(errors.length ? `\n!! PAGE ERRORS: ${errors.join(' | ')}` : '\nno page errors');
    await context.close();
  } catch (err) {
    console.error('\n!! FAILED: ' + (err?.message || err));
  } finally {
    await browser.close().catch(() => {});
    killTree(server);
    console.log(`\noutput in ${outDir}`);
    process.exit(0);
  }
}

main().catch(e => { console.error('crashed:', e); process.exit(1); });
