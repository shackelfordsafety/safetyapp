/* Builds the simulator's seed documents from the test fixtures.

   Fonzo, 2026-09-12: "setting me up like a simulation branch where i have
   buttons that create a full jsa, i submit and make sure everything is
   clean". Filling six documents by hand to test one button is the part
   worth automating.

   Derived from the fixtures rather than hand-written, because those
   already satisfy every readiness check -- the suites would fail
   otherwise. A hand-written seed would drift the first time a required
   field is added, and would fail silently by leaving the checklist one
   item short.

   Signature images are stripped. They are tens of kilobytes of base64
   each, they would be somebody else's real signature riding around in a
   seed, and drawing one is part of what Fonzo is testing anyway.

   Run after changing a fixture:
     node tools/testing/build-sim-seeds.mjs
*/

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join('tools', 'testing', 'fixtures');
const OUT = path.join('src', 'sim', 'seeds.json');

const SOURCES = {
  jsa: 'entergy-taps-draft.json',
  incident: 'incident-full-fixture.json',
  disciplinary: 'disciplinary-normal.json',
  separation: 'separation-new-involuntary.json',
  medicalEvent: 'medical-work-event.json',
  uncontrolledEvent: 'uncontrolled-spill.json',
};

/* Anything that is a signature, a photo, or bookkeeping about a previous
   run. Dropped wherever it appears, at any depth. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && v.startsWith('data:image/')) continue;
      if (k === 'crewSignatures' || k === 'photos') { out[k] = []; continue; }
      if (['id', 'lastSavedAt', 'completedAt', 'archivedPublicationId'].includes(k)) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

const seeds = {};
for (const [docType, file] of Object.entries(SOURCES)) {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8'));
  const seed = clean(raw);
  seed.status = 'draft';
  seeds[docType] = seed;
  console.log(`${docType.padEnd(18)} ${(JSON.stringify(seed).length / 1024).toFixed(1)} KB  (from ${file})`);
}

writeFileSync(OUT, `${JSON.stringify(seeds, null, 2)}\n`);
console.log(`\n-> ${OUT}  ${(JSON.stringify(seeds).length / 1024).toFixed(1)} KB total`);
