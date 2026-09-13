/* Crop and zoom part of a PNG, for looking closely at a raster that did
   not come out of a PDF -- see capture-signin-raster.mjs.

   Coordinates are CSS px on an 816-wide page, the same as
   crop-pdf-region.mjs, so the two tools take the same numbers.

     node tools/testing/crop-png-region.mjs <png> <x> <y> <w> <h> <out.png> [zoom] */

import { readFileSync, writeFileSync } from 'node:fs';
import { cropZoom } from './analyze-pdf-centering.mjs';
import zlib from 'node:zlib';

const [src, xs, ys, ws, hs, outPath, zoomStr] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: crop-png-region.mjs <png> <x> <y> <w> <h> <out.png> [zoom]');
  process.exit(1);
}

/* Minimal PNG reader: enough for the non-interlaced, 8-bit RGB/RGBA files
   html2canvas produces. */
function readPng(buf) {
  let at = 8;
  let width = 0; let height = 0; let colorType = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]; pos += 1;
    const row = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { pixels, width, height, channels };
}

const raster = readPng(readFileSync(src));
const scale = raster.width / 816;
const zoom = Number(zoomStr || 3);
const png = cropZoom(
  raster,
  Math.round(Number(xs) * scale), Math.round(Number(ys) * scale),
  Math.round(Number(ws) * scale), Math.round(Number(hs) * scale),
  zoom,
);
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${ws}x${hs} CSS px at zoom ${zoom}, source scale ${scale.toFixed(2)})`);
