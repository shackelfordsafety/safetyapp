// Generates public/share-card.png -- the picture that shows up when
// somebody texts or Slacks a link to this app.
//
// Run once, or again whenever the branding changes:
//   node tools/testing/make-share-card.mjs
//
// 1200x630 is the size every link-preview scraper is built around. PNG
// rather than the .webp logo on purpose: iMessage handles webp fine but
// several other previewers still don't, and a share card that silently
// fails on one of them puts us right back to the scraper guessing.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const logo = readFileSync(path.join(repoRoot, 'public', 'icons', 'shackelford-logo.webp')).toString('base64');
const outPath = path.join(repoRoot, 'public', 'share-card.png');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px;
    background: #171719;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    position: relative;
  }
  /* The logo file in this repo is only 165x49, so anything past about 2x
     turns to mush. It sits modest and sharp and the type carries the card
     -- link previews get displayed small anyway, so legible beats big. */
  img { width: 330px; height: auto; }
  .rule { width: 260px; height: 6px; background: #C1121F; margin: 40px 0 34px; border-radius: 3px; }
  .sub {
    color: #FFFFFF; font-size: 52px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase;
    text-align: center; line-height: 1.15; max-width: 900px;
  }
  .edge { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; background: #C1121F; }
</style></head><body>
  <img src="data:image/webp;base64,${logo}" alt="">
  <div class="rule"></div>
  <div class="sub">Safety Documentation Center</div>
  <div class="edge"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: outPath });
await browser.close();
console.log('Wrote', outPath);
