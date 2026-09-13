/* Show, in readable text, exactly what differs inside one PDF stream.

   compare-pdf-bytes.mjs says WHICH streams differ. This says WHAT. Used
   to settle whether a difference is the paperwork changing or just the
   date the file was made being printed on it.

     node tools/testing/show-pdf-stream-diff.mjs <before.pdf> <after.pdf> <streamIndex> */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const [beforePath, afterPath, indexArg] = process.argv.slice(2);
const wanted = Number(indexArg);

function streams(buf) {
  const out = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let at = 0;
  for (;;) {
    const start = buf.indexOf(marker, at);
    if (start === -1) break;
    let bodyStart = start + marker.length;
    if (buf[bodyStart] === 0x0d) bodyStart += 1;
    if (buf[bodyStart] === 0x0a) bodyStart += 1;
    const end = buf.indexOf(endMarker, bodyStart);
    if (end === -1) break;
    let body = buf.subarray(bodyStart, end);
    try { body = inflateSync(body); } catch { /* keep raw */ }
    out.push(body);
    at = end + endMarker.length;
  }
  return out;
}

const a = streams(readFileSync(beforePath))[wanted];
const b = streams(readFileSync(afterPath))[wanted];
if (!a || !b) { console.error('no such stream'); process.exit(2); }

const ta = a.toString('latin1');
const tb = b.toString('latin1');

/* Walk to the first and last point they disagree, and print a window
   around it from each side. Enough to recognise a date. */
let head = 0;
while (head < ta.length && head < tb.length && ta[head] === tb[head]) head += 1;
let tail = 0;
while (tail < ta.length - head && tail < tb.length - head
       && ta[ta.length - 1 - tail] === tb[tb.length - 1 - tail]) tail += 1;

const from = Math.max(0, head - 60);
console.log(`first difference at byte ${head} of ${ta.length}`);
console.log(`\nBEFORE: ...${ta.slice(from, ta.length - tail + 20).replace(/[^\x20-\x7e]/g, '.')}...`);
console.log(`\nAFTER : ...${tb.slice(from, tb.length - tail + 20).replace(/[^\x20-\x7e]/g, '.')}...`);
