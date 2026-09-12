/* Every word the app puts in front of a person, in one list.

   Written for the 2026-09-12 wording audit: Fonzo asked for "every single
   thing" checked against how real safety apps word things, and that is not
   a job you can do from memory of the codebase.

   DELIBERATELY EXCLUDED: the hazard, control and task libraries. That is
   his safety content, approved line by line, and it is not UI copy -- see
   the never-invent-safety-content rule. */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'src';
const SKIP_FILES = new Set(['sitePacks.js']);
// Blocks of safety content inside main.jsx, by the constant that holds them.
const CONTENT_CONSTS = /^(TASK_|HAZARD|CONTROL|SUGGEST|QUICK_|BUNDLE)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|css)$/.test(name) && !SKIP_FILES.has(name)) out.push(full);
  }
  return out;
}

const found = [];
function add(file, line, kind, text) {
  const t = text.trim();
  if (!t || t.length < 3) return;
  if (!/[a-z]/.test(t)) return;                 // not prose
  if (/^[a-z-]+$/.test(t)) return;              // css class / id
  if (/^(https?:|\.\/|#|\$\{)/.test(t)) return; // urls, paths, template bits
  /* Inline styles and stray code. ErrorBoundary.jsx styles itself with a
     plain object (it has to survive the app being broken), so without
     these the list fills up with "14px" and "1px solid #DEDEE1". */
  if (/^[\d.]+(px|em|rem|vh|vw|in|%|s)\b/.test(t)) return;
  if (/^(#[0-9a-f]{3,8}|rgba?\()/i.test(t)) return;
  if (/[;{}]|=>|&&|\|\||\bNumber\(/.test(t)) return;
  if (/(solid|sans-serif|system-ui|@page)\b/.test(t)) return;
  found.push({ file, line, kind, text: t });
}

for (const file of walk(ROOT)) {
  if (file.endsWith('.css')) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let inContentBlock = false;

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw;

    // Skip the safety-content constants wholesale.
    const constMatch = line.match(/^(?:export\s+)?const\s+([A-Z_0-9]+)\s*=/);
    if (constMatch) inContentBlock = CONTENT_CONSTS.test(constMatch[1]);
    if (inContentBlock) return;

    // Comments are not user-facing.
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (!code.trim()) return;

    // Text between JSX tags.
    for (const m of code.matchAll(/>([^<>{}]+)</g)) add(file, n, 'text', m[1]);

    // Copy-carrying props.
    for (const m of code.matchAll(/\b(label|title|intro|placeholder|help|hint|aria-label|nextLabel|subtitle|startNewLabel|downloadLabel|generateLabel|regenerateLabel|generatingLabel)\s*=\s*["']([^"']+)["']/g)) {
      add(file, n, m[1], m[2]);
    }

    // Toasts and confirms.
    for (const m of code.matchAll(/(?:showToast|confirm|alert)\(\s*[`'"]([^`'"]+)[`'"]/g)) add(file, n, 'toast/confirm', m[1]);

    // Copy objects: key: 'Some sentence.'
    for (const m of code.matchAll(/^\s*[a-zA-Z][a-zA-Z0-9]*\s*:\s*'([^']{4,})'/g)) add(file, n, 'copy', m[1]);
  });
}

// De-duplicate identical text, keeping where it appears.
const byText = new Map();
for (const f of found) {
  const key = f.text;
  if (!byText.has(key)) byText.set(key, { text: key, kind: f.kind, places: [] });
  byText.get(key).places.push(`${f.file}:${f.line}`);
}

const all = [...byText.values()].sort((a, b) => a.text.localeCompare(b.text));
const out = all.map(s => `${s.text}\n    [${s.kind}] ${s.places.slice(0, 3).join(', ')}${s.places.length > 3 ? ` (+${s.places.length - 3} more)` : ''}`).join('\n');
writeFileSync('reports/audits/ui-strings.txt', `${all.length} distinct user-facing strings\n\n${out}\n`);
console.log(`${all.length} distinct strings -> reports/audits/ui-strings.txt`);
console.log(`words total: ${all.reduce((n, s) => n + s.text.split(/\s+/).length, 0)}`);
