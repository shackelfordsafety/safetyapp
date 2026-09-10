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
console.log('Wrote', outPath);

/* ── The home-screen icon ──
   Separate from the share card, same brand. Without an apple-touch-icon
   iOS renders a SCREENSHOT of the page as the icon, which for the crew
   sign-in page is an unreadable grey smudge -- and "save it to your home
   screen" is the answer we're giving the crew, so the thing they end up
   looking at matters.

   180x180 is the size iOS asks for. One icon serves both the app and the
   crew page; what differs is the label underneath ("Safety Docs" vs
   "Sign JSA"), which is set in index.html. */
const iconPath = path.join(repoRoot, 'public', 'icons', 'apple-touch-icon.png');
const iconSvg = readFileSync(path.join(repoRoot, 'public', 'icons', 'safety-icon.svg'), 'utf8')
  // iOS masks the corners itself, so a rounded source would be rounded
  // twice and end up looking pinched.
  .replace(/ rx="104"/, '');
const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body { width: 180px; height: 180px; }
  svg { display: block; width: 180px; height: 180px; }
</style></head><body>${iconSvg}</body></html>`;

const iconPage = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
await iconPage.setContent(iconHtml, { waitUntil: 'networkidle' });
await iconPage.screenshot({ path: iconPath });
await browser.close();
console.log('Wrote', iconPath);
