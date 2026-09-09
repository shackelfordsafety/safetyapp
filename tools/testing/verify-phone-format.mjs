// The phone formatting rules, checked directly.
//
// The risk here is not that it fails to prettify something -- it is that it
// rearranges a number it misread, and a man dials the wrong thing off a
// JSA. So most of these cases are about what it must LEAVE ALONE.
//
// Usage: node tools/testing/verify-phone-format.mjs

import { formatPhone, isDialable, phoneDigits } from '../../src/shared/phone.js';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
}

// What Fonzo actually typed, and what he expected to see.
check('a bare ten-digit run reads as a phone number',
  formatPhone('6626102036'), '(662) 610-2036');

check('already-formatted stays put', formatPhone('(601) 555-0142'), '(601) 555-0142');
check('dashes are normalised', formatPhone('601-555-0142'), '(601) 555-0142');
check('spaces are normalised', formatPhone('601 555 0142'), '(601) 555-0142');
check('a leading 1 is understood', formatPhone('16625550142'), '(662) 555-0142');
check('seven digits get a dash', formatPhone('5550142'), '555-0142');

// The ones it must not touch.
check('911 is left exactly alone', formatPhone('911'), '911');
check('two numbers in one field are left alone',
  formatPhone('911 / 601-555-0199'), '911 / 601-555-0199');
check('an extension is left alone',
  formatPhone('601-555-0142 ext 12'), '601-555-0142 ext 12');
check('a note is left alone', formatPhone('cell 6015550142'), 'cell 6015550142');
check('an unrecognised length is left alone', formatPhone('12345'), '12345');
check('empty stays empty', formatPhone(''), '');
check('null does not throw', formatPhone(null), '');

// What is safe to hand to a dialer.
check('911 is dialable', isDialable('911'), true);
check('a ten-digit number is dialable', isDialable('6626102036'), true);
check('two numbers in one field are NOT dialable', isDialable('911 / 601-555-0199'), false);
check('a number with an extension is NOT dialable', isDialable('601-555-0142 ext 12'), false);
check('gibberish is not dialable', isDialable('12345'), false);

// The dialed string is digits only, whatever the punctuation was.
check('dial string strips formatting', phoneDigits('(662) 610-2036'), '6626102036');

console.log(failures === 0 ? '\nAll phone rules hold.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
