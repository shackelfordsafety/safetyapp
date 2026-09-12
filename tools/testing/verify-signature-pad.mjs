// Interactive signature-capture regression script (Incident Report v0.1.4).
//
// Not part of the application build or bundle -- lives entirely under
// tools/testing/ and is invoked manually with
// `node tools/testing/verify-signature-pad.mjs`. Requires `npm run build`
// to have already produced dist/, and the `playwright` dev dependency
// (+ `npx playwright install chromium`) to be installed.
//
// verify-incident-pdf.mjs proves that a signature *already present in a
// fixture's data* renders correctly in the exported PDF, but never actually
// draws one -- it can't catch a regression in SignaturePad's own capture
// area (dimensions, responsive resize, pointer-to-canvas coordinate
// mapping). This script closes that gap: for each of three viewports
// (desktop, tablet/iPad, phone) it seeds the real "full" fixture (which has
// an unsigned witness slot -- Witness 2, "Jake Lytle" -- to sign), drives
// the real UI to open that witness's signature pad, measures the rendered
// canvas against the v0.1.4 target dimensions, draws a signature with real
// pointer input, saves it, and confirms a non-empty preview image was
// produced. On the desktop pass it additionally carries that interactively-
// drawn signature all the way through PDF export and asserts it renders as
// an <img> inside the Witness 2 signature cell on the real generated page --
// proving the whole capture -> save -> print pipeline, not just the canvas.
//
// Also runs the same viewport suite under WebKit (best-effort -- some hosts
// can't launch the WebKit binary at all; that's logged as a skip, not a
// failure) plus a dedicated real-touch-gesture pass on Chromium mobile
// emulation (via CDP Input.dispatchTouchEvent, not synthetic JS events) that
// specifically regression-guards the iOS Safari fix in SignaturePad.jsx:
// removing onPointerLeave as a stroke-ending trigger (WebKit has fired
// spurious pointerleave mid-touch-drag on a pointer-captured element, ending
// the stroke after the first move) in favor of onPointerCancel, which is
// also exercised directly (mid-stroke touchcancel) to prove drawing recovers
// cleanly on the next gesture instead of leaving state stuck.
//
// Exits nonzero on any assertion failure, console error, or page error.
// WebKit being unavailable on the host is a skip (logged), not a failure.

import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { killTree } from './lib/killTree.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(__dirname, process.env.SIGNATURE_VERIFY_OUTDIR || 'output', 'signature-pad');
mkdirSync(outDir, { recursive: true });

const PORT = 4322;
const BASE_URL = `http://localhost:${PORT}`;

// v0.1.4 target dimensions -- see SignaturePad.jsx's PAD_HEIGHT_DESKTOP /
// PAD_HEIGHT_PHONE / PAD_WIDTH_MIN / PAD_WIDTH_MAX / PHONE_BREAKPOINT_PX.
// expectMinWidth is deliberately lower on phone: SignaturePad fills 100% of
// its real container (paired with a date field in a half-width formPairRow
// column -- see IncidentWorkflow.jsx), and that real container is narrower
// on a 390px-wide viewport than on tablet/desktop. That's correct existing
// form-layout behavior, not a signature-pad regression, so the floor here
// reflects the real achievable width rather than an arbitrary round number.
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900, expectHeight: 170, expectMinWidth: 200, runExport: true },
  { name: 'tablet', width: 820, height: 1180, expectHeight: 170, expectMinWidth: 200, runExport: false },
  { name: 'phone', width: 390, height: 844, expectHeight: 145, expectMinWidth: 180, runExport: false },
];

function makeAssertions() {
  const failures = [];
  return {
    check(condition, message) { if (!condition) failures.push(message); },
    failures,
  };
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Server at ${url} did not become ready in time`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

/* Draws a simple multi-stroke scribble across the canvas using real mouse
   (-> Pointer Events, the same code path SignaturePad listens on regardless
   of pointerType) input -- exercises getPoint()'s rendered-rect-to-internal-
   coordinate-space mapping exactly the way a finger/stylus drag would. */
async function drawScribble(page, canvasBox) {
  const { x, y, width, height } = canvasBox;
  const points = [
    [x + width * 0.12, y + height * 0.7],
    [x + width * 0.25, y + height * 0.25],
    [x + width * 0.4, y + height * 0.75],
    [x + width * 0.55, y + height * 0.3],
    [x + width * 0.7, y + height * 0.7],
    [x + width * 0.85, y + height * 0.35],
  ];
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [px, py] of points.slice(1)) {
    await page.mouse.move(px, py, { steps: 6 });
  }
  await page.mouse.up();
}

/* Real native touch input via CDP (Chromium only -- WebKit exposes no CDP
   session) rather than page.mouse or synthetic JS-dispatched events, so this
   goes through the browser's actual touch-action / pointer-capture pipeline
   the way a finger on glass would, not just SignaturePad's JS logic. */
async function touchDrag(session, points) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
  for (const [px, py] of points.slice(1)) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* Scans a canvas's own bitmap for non-transparent pixels and reports the
   horizontal ink range -- shared by every check below instead of repeating
   the pixel scan inline. */
async function readInkSpread(canvas) {
  return canvas.evaluate((el) => {
    const ctx = el.getContext('2d');
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    for (let px = 0; px < width; px += 2) {
      for (let py = 0; py < height; py += 2) {
        if (data[(py * width + px) * 4 + 3] > 10) {
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
    }
    return { minX, maxX, minY, maxY, width, height };
  });
}

/* Regression-guards the SignaturePad.jsx native-touch rewrite: real finger
   input now runs entirely through canvas.addEventListener('touchstart'/...)
   rather than Pointer Events (see pointerDown's `if (e.pointerType ===
   'touch') return`). This proves, all via real CDP touch dispatch through
   the browser's actual touch pipeline (never by calling internal drawing
   functions):
     - a finger drag draws visible ink, surviving a move outside the
       canvas's own bounds mid-gesture (boundary-crossing safety net, kept
       from the earlier pointerleave-era regression)
     - a second finger landing mid-stroke is ignored -- only the original
       finger's path is drawn (native-touch identifier tracking)
     - a mid-gesture touchcancel resets cleanly so the very next stroke
       draws normally (not left stuck)
     - touch inside the canvas does not scroll the page; touch just outside
       it scrolls normally (touch-action: none is scoped to the pad, not
       global)
     - the touch-drawn signature saves to a real PNG preview and survives
       all the way through PDF export as a real image -- the full capture
       -> save -> print pipeline, sourced entirely from finger input. */
async function runTouchGestureCheck(browser, fixtureJson) {
  const a = makeAssertions();
  console.log('\n=== Touch-gesture pass (Chromium mobile emulation, real CDP touch input) ===');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.addInitScript((json) => { window.localStorage.setItem('sdc.incident.draft.v1', json); }, fixtureJson);
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Witnesses/ }).click();
  await page.getByRole('button', { name: 'Add signature' }).first().click();
  const canvas = page.locator('.signatureCanvas').first();
  await canvas.waitFor({ state: 'visible' });
  let box = await canvas.boundingBox();

  const session = await context.newCDPSession(page);

  console.log('  [1/7] Drawing with real touch input, crossing above the canvas top edge mid-stroke...');
  await touchDrag(session, [
    [box.x + box.width * 0.1, box.y + box.height * 0.6],
    [box.x + box.width * 0.3, box.y + box.height * 0.2],
    [box.x + box.width * 0.5, box.y - 25], // outside the canvas bounds, still mid-gesture
    [box.x + box.width * 0.7, box.y + box.height * 0.3],
    [box.x + box.width * 0.9, box.y + box.height * 0.6],
  ]);
  const inkSpread = await readInkSpread(canvas);
  a.check(inkSpread.maxX > inkSpread.minX, 'expected touch-drawn ink to span a real horizontal range');
  a.check(inkSpread.minX < inkSpread.width * 0.35, `expected touch ink to reach near the left side, leftmost at x=${inkSpread.minX} of ${inkSpread.width}`);
  a.check(inkSpread.maxX > inkSpread.width * 0.65, `expected touch ink to reach near the right side (stroke survives crossing above the canvas mid-gesture), rightmost at x=${inkSpread.maxX} of ${inkSpread.width}`);

  console.log('  [2/7] Clearing, then drawing with two simultaneous fingers (only the first should control the stroke)...');
  await page.locator('.signaturePadActions button', { hasText: /^Clear$/ }).click();
  const fingerAY = box.y + box.height * 0.25; // top band -- finger A's whole path stays here
  const fingerBY = box.y + box.height * 0.85; // bottom band -- finger B's whole path stays here, well separated
  // touchStart with only finger A (id 0); then a second touchStart carrying
  // BOTH ids represents finger B landing while A is still down -- CDP diffs
  // against the previously dispatched touch state to compute changedTouches,
  // the same way a real multi-touch gesture would.
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.15, y: fingerAY, id: 0 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.35, y: fingerAY, id: 0 }] });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width * 0.35, y: fingerAY, id: 0 }, { x: box.x + box.width * 0.35, y: fingerBY, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: box.x + box.width * 0.6, y: fingerAY, id: 0 }, { x: box.x + box.width * 0.6, y: fingerBY, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: box.x + box.width * 0.6, y: fingerBY, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const multiTouchSpread = await readInkSpread(canvas);
  a.check(multiTouchSpread.maxX > multiTouchSpread.minX, 'expected the tracked finger to draw ink during the two-finger gesture');
  // Finger A stays in the top ~25% band; finger B (ignored) sits at ~85%.
  // Ink reaching anywhere near finger B's band would mean the second finger
  // was drawing too, not just being tracked-and-ignored.
  a.check(
    multiTouchSpread.maxY < box.height * 0.6,
    `expected ink to stay in the tracked finger's band only (~25%), not reach the second (ignored) finger's band at ~85% -- got ink up to y=${multiTouchSpread.maxY} of ${box.height}`,
  );

  console.log('  [3/7] Clearing, then interrupting a new stroke with touchcancel...');
  await page.locator('.signaturePadActions button', { hasText: /^Clear$/ }).click();
  const blankAfterClear = await readInkSpread(canvas);
  a.check(blankAfterClear.maxX === 0 && blankAfterClear.minX === blankAfterClear.width, `expected Clear to leave the canvas blank, got ink from x=${blankAfterClear.minX} to x=${blankAfterClear.maxX}`);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.35, y: box.y + box.height * 0.5 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });

  console.log('  [4/7] Drawing a fresh stroke immediately after the cancel...');
  await touchDrag(session, [
    [box.x + box.width * 0.15, box.y + box.height * 0.5],
    [box.x + box.width * 0.5, box.y + box.height * 0.3],
    [box.x + box.width * 0.85, box.y + box.height * 0.5],
  ]);
  const recoverySpread = await readInkSpread(canvas);
  a.check(recoverySpread.maxX > recoverySpread.minX, 'expected a fresh stroke drawn right after a mid-gesture touchcancel to actually render ink (drawingRef not left stuck)');

  console.log('  [5/7] Checking scroll behavior: touch inside the canvas must not scroll, touch just outside it must...');
  await page.locator('.signaturePadActions button', { hasText: /^Clear$/ }).click();

  const scrollBefore1 = await page.evaluate(() => document.scrollingElement.scrollTop);
  await touchDrag(session, [
    [box.x + box.width * 0.5, box.y + box.height * 0.8],
    [box.x + box.width * 0.5, box.y + box.height * 0.2],
  ]);
  const scrollAfterInside = await page.evaluate(() => document.scrollingElement.scrollTop);
  a.check(scrollAfterInside === scrollBefore1, `expected no page scroll from a touch drag inside the signature canvas (scrollTop ${scrollBefore1} -> ${scrollAfterInside})`);
  const insideDragSpread = await readInkSpread(canvas);
  a.check(insideDragSpread.maxY > insideDragSpread.minY, 'expected the inside-canvas scroll-check drag to still draw ink (touch-action: none is not blocking drawing)');

  // A real behavioral scroll simulation was attempted here (raw touchmove
  // samples, then incremental samples with real elapsed time between them,
  // then CDP's purpose-built Input.synthesizeScrollGesture) and all three
  // produced zero scroll movement in this specific headless-Chromium-on-
  // Windows environment, even though document.scrollingElement demonstrably
  // has 150px+ of headroom and responds instantly to a programmatic
  // window.scrollTo() -- i.e. the page is genuinely scrollable, Chromium's
  // touch-to-scroll *compositor* gesture recognition just isn't reliably
  // triggerable via CDP here. Asserting on the actual invariant instead:
  // touch-action is scoped to the canvas only, not any ancestor up to
  // <html> -- confirmed via a real DOM walk from the exact point just
  // outside the pad, not by hoping a simulated gesture lands.
  const outsideY = Math.max(8, box.y - 40); // just above the pad, outside its bounds -- normal page chrome
  const outsideX = box.x + box.width * 0.5;
  const touchActionAtOutsidePoint = await page.evaluate(({ x, y }) => {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const ta = getComputedStyle(el).touchAction;
      if (ta === 'none') return { blocked: true, tag: el.tagName, cls: String(el.className || '') };
      el = el.parentElement;
    }
    return { blocked: false };
  }, { x: outsideX, y: outsideY });
  a.check(!touchActionAtOutsidePoint.blocked, `expected touch-action to allow normal scrolling just outside the signature canvas, but found touch-action: none on <${touchActionAtOutsidePoint.tag}${touchActionAtOutsidePoint.cls ? ' class="' + touchActionAtOutsidePoint.cls + '"' : ''}>`);
  const canvasTouchAction = await canvas.evaluate((el) => getComputedStyle(el).touchAction);
  a.check(canvasTouchAction === 'none', `expected the signature canvas itself to keep touch-action: none, got "${canvasTouchAction}"`);

  console.log('  [6/7] Drawing the final signature via touch, saving, and checking the preview...');
  await page.locator('.signaturePadActions button', { hasText: /^Clear$/ }).click();
  await touchDrag(session, [
    [box.x + box.width * 0.12, box.y + box.height * 0.7],
    [box.x + box.width * 0.35, box.y + box.height * 0.25],
    [box.x + box.width * 0.6, box.y + box.height * 0.7],
    [box.x + box.width * 0.85, box.y + box.height * 0.3],
  ]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const preview = page.locator('.signaturePreview').first();
  await preview.waitFor({ state: 'visible', timeout: 5000 });
  const previewSrc = await preview.getAttribute('src');
  a.check(Boolean(previewSrc && previewSrc.startsWith('data:image/png')), `expected the touch-drawn signature preview to be a PNG data URL, got "${previewSrc?.slice(0, 30)}..."`);

  console.log('  [7/7] Carrying the touch-drawn signature through full PDF export...');
  await page.getByRole('tab').last().click();
  await page.locator('.reviewPrimaryAction button, button:has-text("Want a paper copy first?"), button:has-text("Update the printout")').first().click();
  await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });
  const page3 = page.locator('.incidentPdfExportRoot .incidentPage').nth(2);
  const sigImages = page3.locator('.incSignatureImage');
  const sigCount = await sigImages.count();
  a.check(sigCount === 2, `expected both Witness 1 (fixture) and Witness 2 (touch-drawn) signatures to render on page 3, found ${sigCount}`);
  if (sigCount === 2) {
    const secondSrc = await sigImages.nth(1).getAttribute('src');
    a.check(Boolean(secondSrc && secondSrc.startsWith('data:image/png')), 'expected the touch-drawn Witness 2 signature to render as a real PNG image in the exported PDF page');
  }

  a.check(consoleErrors.length === 0, `no console errors (${consoleErrors.length} found)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
  a.check(pageErrors.length === 0, `no page errors (${pageErrors.length} found)${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

  if (a.failures.length) {
    console.error('  FAILED ASSERTIONS for touch-gesture pass:');
    a.failures.forEach((f) => console.error(`    - ${f}`));
  } else {
    console.log('  All assertions passed.');
  }

  await context.close();
  return { pass: 'touch-gesture', assertionFailures: a.failures, consoleErrors, pageErrors };
}

async function runViewport(browser, fixtureJson, viewport) {
  const consoleErrors = [];
  const pageErrors = [];
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.addInitScript((json) => {
    window.localStorage.setItem('sdc.incident.draft.v1', json);
  }, fixtureJson);

  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const a = makeAssertions();
  console.log(`\n=== Viewport: ${viewport.name} (${viewport.width}x${viewport.height}) ===`);

  console.log('  [1/6] Loading app with seeded draft, opening Witnesses step...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue Incident Report' }).click();
  await page.getByRole('tab', { name: /^Witnesses/ }).click();

  console.log('  [2/6] Opening the unsigned witness (Witness 2) signature pad...');
  const addSignatureBtn = page.getByRole('button', { name: 'Add signature' }).first();
  await addSignatureBtn.waitFor({ state: 'visible' });
  await addSignatureBtn.click();

  const wrap = page.locator('.signatureCanvasWrap').first();
  const canvas = page.locator('.signatureCanvas').first();
  await canvas.waitFor({ state: 'visible' });

  console.log('  [3/6] Measuring rendered pad dimensions...');
  const wrapBox = await wrap.boundingBox();
  const canvasBox = await canvas.boundingBox();
  a.check(Boolean(canvasBox && canvasBox.width > 0 && canvasBox.height > 0), 'expected the signature canvas to have a measurable rendered size');
  if (canvasBox) {
    a.check(canvasBox.width >= viewport.expectMinWidth, `expected the pad to render at least ~${viewport.expectMinWidth}px wide on ${viewport.name}, got ${canvasBox.width.toFixed(1)}px`);
    a.check(
      Math.abs(canvasBox.height - viewport.expectHeight) <= 2,
      `expected pad height ~${viewport.expectHeight}px for ${viewport.name}, got ${canvasBox.height.toFixed(1)}px`,
    );
  }
  if (wrapBox && canvasBox) {
    a.check(
      canvasBox.width <= wrapBox.width + 1,
      `expected the canvas to stay within its container width (no horizontal overflow): canvas ${canvasBox.width.toFixed(1)}px vs container ${wrapBox.width.toFixed(1)}px`,
    );
    const canvasRight = canvasBox.x + canvasBox.width;
    a.check(canvasRight <= viewport.width + 1, `expected the canvas not to overflow the viewport (right edge ${canvasRight.toFixed(1)}px vs viewport width ${viewport.width}px)`);
  }

  console.log('  [4/6] Drawing a signature with real pointer input...');
  await drawScribble(page, canvasBox);

  // Coordinate-mapping sanity check: the canvas's internal bitmap should
  // now contain non-transparent pixels roughly where the stroke was drawn
  // (left/right thirds), not compressed into a corner -- a regression in
  // toCanvasPoint()'s scale factor would show up as ink bunched at one edge.
  const inkSpread = await readInkSpread(canvas);
  a.check(inkSpread.maxX > inkSpread.minX, 'expected drawn ink to span a real horizontal range on the canvas bitmap (coordinate mapping sanity check)');
  a.check(inkSpread.minX < inkSpread.width * 0.35, `expected ink to reach near the left side of the pad, leftmost ink at x=${inkSpread.minX} of ${inkSpread.width}`);
  a.check(inkSpread.maxX > inkSpread.width * 0.65, `expected ink to reach near the right side of the pad, rightmost ink at x=${inkSpread.maxX} of ${inkSpread.width}`);

  console.log('  [5/6] Saving and checking the preview renders...');
  // exact: true -- getByRole's default substring match would also match the
  // unrelated header "Save Now" button, causing a strict-mode violation.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const preview = page.locator('.signaturePreview').first();
  await preview.waitFor({ state: 'visible', timeout: 5000 });
  const previewSrc = await preview.getAttribute('src');
  a.check(Boolean(previewSrc && previewSrc.startsWith('data:image/png')), `expected the saved signature preview to be a PNG data URL, got "${previewSrc?.slice(0, 30)}..."`);

  let exportInfo = null;
  if (viewport.runExport) {
    console.log('  [6/6] Carrying the drawn signature through full PDF export...');
    await page.getByRole('tab').last().click();
    await page.locator('.reviewPrimaryAction button, button:has-text("Want a paper copy first?"), button:has-text("Update the printout")').first().click();
    await page.locator('.pdfReadyPanel').waitFor({ state: 'visible', timeout: 30000 });

    const page3 = page.locator('.incidentPdfExportRoot .incidentPage').nth(2);
    const sigImages = page3.locator('.incSignatureImage');
    const sigCount = await sigImages.count();
    a.check(sigCount === 2, `expected both Witness 1 (fixture) and Witness 2 (interactively drawn) signatures to render on page 3, found ${sigCount}`);
    if (sigCount === 2) {
      const secondSrc = await sigImages.nth(1).getAttribute('src');
      a.check(Boolean(secondSrc && secondSrc.startsWith('data:image/png')), 'expected the interactively-drawn Witness 2 signature to render as a real PNG image in the exported PDF page');
    }
    exportInfo = { sigCount };
  } else {
    console.log('  [6/6] Skipping full export on this viewport (desktop pass already covers it).');
  }

  if (a.failures.length) {
    console.error(`  FAILED ASSERTIONS for viewport "${viewport.name}":`);
    a.failures.forEach((f) => console.error(`    - ${f}`));
  } else {
    console.log('  All assertions passed.');
  }

  const summary = {
    viewport: viewport.name,
    generatedAt: new Date().toISOString(),
    canvasBox,
    wrapBox,
    previewSrcPrefix: previewSrc?.slice(0, 30) || null,
    exportInfo,
    assertionFailures: a.failures,
    consoleErrors,
    pageErrors,
  };
  writeFileSync(path.join(outDir, `${viewport.name}-summary.json`), JSON.stringify(summary, null, 2));

  await context.close();
  return summary;
}

async function main() {
  console.log('[1/2] Starting vite preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  try {
    await waitForServer(BASE_URL, 20000);
    console.log('[2/2] Preview server ready at', BASE_URL);

    // This fixture is shared with verify-incident-pdf.mjs, which deliberately
    // relies on its seeded status: 'ready' to test final/un-watermarked
    // rendering -- so the shared fixture file itself must stay 'ready'.
    // This script's own purpose is drawing the still-missing Witness 2
    // signature, which now requires an unlocked ('draft') document (see the
    // app-wide draft/finish/lock UX mission -- 'ready' is genuinely locked
    // now, not just un-watermarked), so it patches its own in-memory copy
    // rather than changing the shared file.
    const fixtureJson = JSON.stringify({ ...JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'incident-full-fixture.json'), 'utf8')), status: 'draft' });

    const summaries = [];
    let webkitSkippedReason = null;

    const chromiumBrowser = await chromium.launch();
    try {
      for (const viewport of VIEWPORTS) {
        summaries.push(await runViewport(chromiumBrowser, fixtureJson, viewport));
      }
      summaries.push(await runTouchGestureCheck(chromiumBrowser, fixtureJson));
    } finally {
      // Always close the browser, even if a viewport throws -- an open
      // browser<->page connection is a live handle that keeps the Node
      // process running indefinitely, which turns one bad assertion into a
      // silently hung script instead of a clean nonzero exit.
      await chromiumBrowser.close();
    }

    // WebKit is best-effort: some hosts have the binary installed
    // (`npx playwright install webkit`) but it still can't launch (seen on
    // this project's Windows dev machine -- launches then exits immediately
    // with a native crash unrelated to app code). That's a skip, not a
    // regression failure; real WebKit/iPhone Safari coverage should still be
    // run wherever it's actually available.
    console.log('\n=== Attempting WebKit (real Safari/WebKit engine) ===');
    let webkitBrowser = null;
    try {
      webkitBrowser = await webkit.launch();
    } catch (err) {
      webkitSkippedReason = err.message.split('\n')[0];
      console.warn(`  SKIPPED: WebKit could not be launched on this host (${webkitSkippedReason}). Falling back to Chromium-only coverage for this run -- verify on a real iPhone Safari or a working WebKit host before shipping.`);
    }
    if (webkitBrowser) {
      try {
        for (const viewport of VIEWPORTS) {
          summaries.push({ ...(await runViewport(webkitBrowser, fixtureJson, { ...viewport, name: `webkit-${viewport.name}` })) });
        }
      } finally {
        await webkitBrowser.close();
      }
    }

    console.log('\n=== OVERALL SUMMARY ===');
    console.log(JSON.stringify(summaries.map((s) => ({
      viewport: s.viewport ?? s.pass, assertionFailures: s.assertionFailures.length, consoleErrors: s.consoleErrors.length, pageErrors: s.pageErrors.length,
    })), null, 2));
    if (webkitSkippedReason) console.log(`WebKit: SKIPPED (${webkitSkippedReason})`);

    const anyErrors = summaries.some((s) => s.consoleErrors.length || s.pageErrors.length || s.assertionFailures.length);
    if (anyErrors) {
      console.error('\nFAILED: console/page errors or assertion failures were captured during at least one run (see per-viewport summary.json).');
      process.exitCode = 1;
    } else {
      console.log('\nAll runs passed all assertions with zero console/page errors.' + (webkitSkippedReason ? ' (WebKit skipped -- see above.)' : ''));
    }
  } finally {
    killTree(server);
  }
}

main().then(() => {
  // Explicit success exit: the spawned 'vite preview' grandchild keeps Node's
  // event loop alive on Windows even after server.kill(), so a PASSING run
  // would otherwise hang until the caller's timeout instead of finishing.
  process.exit(process.exitCode || 0);
}).catch((err) => {
  console.error('Verification script failed:', err);
  process.exitCode = 1;
});
