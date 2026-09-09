// Renders the printable board-QR sheet exactly as the printer would see
// it, so the Shackelford branding on it can actually be looked at.
//
// The sheet lives behind a login (My Board), which this harness has no
// credentials for, so it does NOT drive the real screen. What it does do
// is take the REAL rules out of src/crew/boardqr.css and the REAL markup
// out of BoardQr.jsx, put them on a page under print media emulation, and
// shoot that. So the CSS and the layout being reviewed are the shipping
// ones; only the surrounding app is stubbed.
//
// Usage: node tools/testing/verify-board-qr-sheet.mjs

import { chromium } from 'playwright';
import QRCode from 'qrcode';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, 'output', 'boardqr');
mkdirSync(outDir, { recursive: true });

const css = readFileSync(path.join(repoRoot, 'src', 'crew', 'boardqr.css'), 'utf8');
const logo = readFileSync(path.join(repoRoot, 'public', 'icons', 'shackelford-logo.webp')).toString('base64');

const BOARD_URL = 'https://shackelfordsafety.github.io/safetyapp/#/sign/53ac3e37-efe3-45f6-b6ef-41be5a492afa';
const LABEL = 'Gaines Newell';

async function main() {
  const qr = await QRCode.toDataURL(BOARD_URL, {
    width: 900, margin: 2, errorCorrectionLevel: 'M',
    color: { dark: '#171719', light: '#FFFFFF' },
  });

  // Markup kept byte-identical to BoardQr.jsx's sheet, class for class.
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  ${css}
</style></head>
<body class="printingQr">
  <div class="brdQrSheet">
    <div class="brdQrSheetHead">
      <img class="brdQrSheetLogo" src="data:image/webp;base64,${logo}" alt="">
    </div>
    <div class="brdQrSheetRule"></div>
    <strong class="brdQrSheetTitle">Scan to sign in</strong>
    <span class="brdQrSheetSub">Job Safety Analysis</span>
    <img class="brdQrSheetCode" src="${qr}" alt="">
    <span class="brdQrSheetHow">Point your phone camera at the code. No app, no password.</span>
    <div class="brdQrSheetFoot">Shackelford Construction and Hauling, LLC</div>
  </div>
</body></html>`;

  const htmlPath = path.join(outDir, 'sheet.html');
  writeFileSync(htmlPath, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(outDir, 'qr-sheet.png'), fullPage: true });
  await page.pdf({ path: path.join(outDir, 'qr-sheet.pdf'), format: 'Letter', printBackground: true });
  console.log('Wrote', path.join(outDir, 'qr-sheet.png'));
  console.log('Wrote', path.join(outDir, 'qr-sheet.pdf'));

  /* The reason this check exists now. The first version of this sheet
     measured about 10.2in and broke onto a second page in real life --
     fine inside a 1056px viewport, not fine once the page margins and
     Safari's own URL/date header and footer have taken their cut. The
     second sheet carried three orphaned lines of text.
     Measure it, don't eyeball it. */
  const heightIn = await page.evaluate(() =>
    document.querySelector('.brdQrSheet').getBoundingClientRect().height / 96);
  const onePage = heightIn < 9;
  console.log(`Sheet height: ${heightIn.toFixed(2)}in`);
  console.log(`${onePage ? 'PASS' : 'FAIL'}  fits one page with room for margins and browser headers (< 9in)`);
  console.log('QR encodes:', BOARD_URL);
  await browser.close();
  process.exitCode = onePage ? 0 : 1;
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
