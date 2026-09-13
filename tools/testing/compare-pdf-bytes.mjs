/* Are two PDFs the same document, ignoring when they were made?

   Written to answer one question honestly: after moving pdf-lib and
   html2canvas to load on demand, does the printed paperwork come out
   byte-identical? A file-size diff cannot answer it -- every PDF carries
   its own creation timestamp, so two identical documents made a minute
   apart differ by a couple of bytes and prove nothing either way.

   So: inflate every compressed stream in both files, throw away the
   timestamps and the document ID, and compare what is left -- the actual
   drawing instructions and the embedded page images.

     node tools/testing/compare-pdf-bytes.mjs <beforeDir> <afterDir>   */

import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error('usage: compare-pdf-bytes.mjs <beforeDir> <afterDir>');
  process.exit(2);
}

/* Pull out every `stream ... endstream` body and inflate the ones that
   are deflate-compressed. Anything that will not inflate is kept raw --
   an uncompressed stream is just as much evidence. */
function streamDigests(buf) {
  const digests = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let at = 0;
  for (;;) {
    const start = buf.indexOf(marker, at);
    if (start === -1) break;
    let bodyStart = start + marker.length;
    // Skip the EOL after the `stream` keyword (CRLF or LF, per the spec).
    if (buf[bodyStart] === 0x0d) bodyStart += 1;
    if (buf[bodyStart] === 0x0a) bodyStart += 1;
    const end = buf.indexOf(endMarker, bodyStart);
    if (end === -1) break;

    /* The cross-reference stream is nothing but byte offsets into this
       same file. Change a timestamp by one digit, the compressor emits a
       stream two bytes shorter, and every offset after it shifts -- which
       reads as a difference while saying nothing whatsoever about what is
       printed on the page. It is bookkeeping, so it is not evidence.
       Everything else, including the object streams, is compared. */
    const dict = buf.subarray(Math.max(0, start - 400), start).toString('latin1');
    if (/\/Type\s*\/XRef/.test(dict)) { at = end + endMarker.length; continue; }
    let body = buf.subarray(bodyStart, end);
    let kind = 'raw';
    try { body = inflateSync(body); kind = 'inflated'; } catch { /* not deflate */ }
    /* The timestamps live INSIDE a compressed object stream, not only in
       the outer file -- so they have to be taken out here too, or two runs
       of the identical document three minutes apart look like a change to
       the paperwork. That is exactly what they looked like the first time
       this ran. */
    const normalised = stripVolatile(body.toString('latin1'));
    digests.push({ kind, bytes: body.length, sha: createHash('sha256').update(normalised).digest('hex') });
    at = end + endMarker.length;
  }
  return digests;
}

/* Timestamps and the document ID change on every run by design. */
function stripVolatile(text) {
  return text
    .replace(/\/CreationDate\s*\(D:[^)]*\)/g, '/CreationDate(STRIPPED)')
    .replace(/\/ModDate\s*\(D:[^)]*\)/g, '/ModDate(STRIPPED)')
    .replace(/\/ID\s*\[[^\]]*\]/g, '/ID[STRIPPED]');
}

const files = readdirSync(beforeDir).filter(f => f.endsWith('.pdf')).sort();
let identical = 0;
const differing = [];

for (const name of files) {
  const a = readFileSync(path.join(beforeDir, name));
  const b = readFileSync(path.join(afterDir, name));

  const da = streamDigests(a);
  const db = streamDigests(b);

  const sameCount = da.length === db.length;
  const mismatched = sameCount
    ? da.map((s, i) => (s.sha === db[i].sha ? null : i)).filter(i => i !== null)
    : null;

  /* And the non-stream skeleton, with the timestamps taken out. */
  /* /Length is the COMPRESSED size, which moves when a timestamp inside
     the stream changes by a digit. Normalise it or the skeleton reports a
     difference that the stream comparison above has already cleared. */
  const skeleton = raw => stripVolatile(
    raw.toString('latin1')
      .replace(/stream[\s\S]*?endstream/g, 'stream<>endstream')
      .replace(/\/Length\s+\d+/g, '/Length N')
      /* Same reason as the /XRef skip above: these are positions in the
         file, not content. */
      .replace(/\/(Prev|Index|W|Size|Root|Info)\s*[\d[\]\s]*/g, '/$1 N')
      .replace(/startxref\s*\d+/g, 'startxref N'),
  );
  const skelA = skeleton(a);
  const skelB = skeleton(b);
  const skeletonSame = skelA === skelB;

  const ok = sameCount && mismatched.length === 0 && skeletonSame;
  if (ok) {
    identical += 1;
    console.log(`same   ${name}  (${da.length} streams, every one identical)`);
  } else {
    differing.push(name);
    console.log(`DIFFERS ${name}`);
    if (!sameCount) console.log(`         stream count ${da.length} -> ${db.length}`);
    else if (mismatched.length) {
      console.log(`         ${mismatched.length} of ${da.length} streams differ: #${mismatched.join(', #')}`);
      for (const i of mismatched.slice(0, 3)) {
        console.log(`           #${i} ${da[i].kind} ${da[i].bytes}B -> ${db[i].bytes}B`);
      }
    }
    if (!skeletonSame) console.log('         the page skeleton differs too, not just a stream');
  }
}

console.log(`\n${identical}/${files.length} PDFs are identical once the timestamp is taken out`);
if (differing.length) {
  console.log(`\nStill different: ${differing.join(', ')}`);
  console.log('That is a real change to the printed paperwork -- look at it before shipping.');
}
process.exitCode = differing.length ? 1 : 0;
