// Render a VECTOR pdf to PNG pages for visual review.
//
//   node tools/testing/render-pdf.mjs <pdf> <outDir> [scale]
//
// extract-pdf-images.mjs pulls embedded rasters out of a screenshot-built
// PDF. A drawn-directly PDF has no embedded page rasters by design, so it
// has to actually be rendered. Playwright's Chromium ships no PDF viewer
// (it downloads the file instead), so this loads pdf.js and rasterizes each
// page to a canvas. Needs network the first time only if the CDN copy isn't
// cached by the browser profile.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [pdfPath, outDir, scaleArg] = process.argv.slice(2);
if (!outDir) { console.error('Usage: node tools/testing/render-pdf.mjs <pdf> <outDir> [scale]'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const scale = Number(scaleArg || 2);

const b64 = readFileSync(path.resolve(pdfPath)).toString('base64');

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('console', m => { if (m.type() === 'error') console.log('  page error:', m.text()); });

await page.setContent('<!doctype html><body style="margin:0"></body>');
await page.addScriptTag({ url: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js' });

const dataUrls = await page.evaluate(async ([data, sc]) => {
  const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const viewport = p.getViewport({ scale: sc });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas.toDataURL('image/png'));
  }
  return out;
}, [b64, scale]);

dataUrls.forEach((url, i) => {
  const file = path.join(outDir, `page-${i + 1}.png`);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`page ${i + 1} -> ${file}`);
});

await browser.close();
process.exit(0);
