import { useEffect, useRef, useState } from 'react';

/* ── JSA Crew Sign-In Kiosk (design prototype, 2026-08-13) ──
   Locked, single-purpose full-screen signing flow for passing one shared
   iPad around a crew of up to ~100 people. The problem this solves: on a
   normal screen, a hundred different people tapping around gives everyone
   room to hit the wrong thing, back out, or land on and disturb someone
   else's already-captured signature. The fix is removing everything except
   the one action each person is allowed to take.

   Reuses the same proven canvas-drawing mechanics as SignaturePad
   (src/incident/SignaturePad.jsx) -- DPR-scaled canvas, pointer (mouse/pen)
   handled separately from native touch (finger) input so a touch gesture is
   never drawn twice, round strokes, a bare tap still leaves a dot -- but a
   completely different UI shell: no edit/view toggle, no Cancel/Replace,
   exactly one action ("Confirm & Next"). Once a signature is confirmed it
   is appended to jsa.crewSignatures and this screen has no way to touch it
   again -- only the CURRENT, not-yet-confirmed signature can be cleared and
   redrawn.

   Deliberately open-ended -- no fixed expected-signer count. Crew size
   varies day to day; this keeps going until whoever is running it taps the
   exit control to leave the kiosk, rather than the app trying to pre-guess
   headcount. Exit used to require a hold (to guard against a crew member in
   line bumping it by accident), but a hold-and-drag gesture is exactly what
   iOS Safari's own text-selection magnifying-glass loupe fires on, and the
   two fought each other in the field (Fonzo, 2026-08-17). Switched to a
   plain tap -- exiting doesn't lose anything (every signature is already
   persisted the moment it's confirmed), so an accidental exit just means
   walking back into a kiosk that already has everyone's signatures intact.

   Does NOT wire captured signatures into the printed sign-in sheet
   (AttachedSignIn in main.jsx still prints blank numbered lines for pen
   signing) -- that's a separate, higher-risk print-pipeline change,
   deliberately out of scope for this pass. This component only captures
   and stores the data; nothing about the print pipeline changes. */

// A real signature line is wide and short, not a tall box. SIG_BOX_RATIO is
// measured directly against the real printed .attachedSigLineImg box (363.7
// x 39px at the current 55px sign-in row height -- see
// tools/testing/output/measure-sig-box.mjs, 2026-08-17) so the pad is the
// same SHAPE as the box the ink actually lands in, not just "short enough."
// Recomputed from padWidth on every layout pass instead of a fixed height so
// it stays correct if the row height (SIGNIN_ROW_HEIGHT_PX in main.jsx) ever
// changes again. Print sizing itself doesn't depend on this ratio matching
// exactly (width there is always `auto` from the image's own real
// proportions), but a closer match means people naturally sign at a size
// that was already going to look right (Fonzo, 2026-08-17: "take the exact
// sizing of the box that the signatures are going to go in and have that
// [pad] be where our signatures are going"). MIN_PAD_HEIGHT deliberately
// does NOT chase the exact ratio down to its logical floor -- at this
// kiosk's real measured pad width (~760px, tools/testing/output/
// check-pad-dims.mjs) the literal ratio gives an ~81px-tall canvas, thin
// enough that an ordinary signature's loops/ascenders run off the bottom
// edge (confirmed: it broke verify-crew-signin-kiosk.mjs's own synthetic
// stroke). 130px keeps real drawing room while staying meaningfully
// flatter/wider than the original 200px square-ish pad.
const SIG_BOX_RATIO = 363.7 / 39; // ~9.33 -- wide and short
const MIN_PAD_HEIGHT = 130;
const CONFIRM_PAUSE_MS = 1200;
// Set (not added to whatever was there) once signing wraps up -- there's no
// more manual "how many lines" picker upstream (StepSignatures), so this is
// the one place that number ever gets decided (Fonzo, 2026-08-19: "after
// you click done it should auto add 20 extra signatures in case visitors
// come in later or late ppl").
const EXTRA_BLANK_LINES_AFTER_SIGNING = 20;

function padHeightFor(width) {
  return Math.max(MIN_PAD_HEIGHT, Math.round(width / SIG_BOX_RATIO));
}

/* onSign is how a board posting uses this screen: given one, each
   confirmed signature is handed over instead of being appended to the
   JSA on this device. That is what lets an iPad signature land in the
   same place a phone signature does, which is the whole reason the two
   used to drift apart. Without it the component behaves exactly as
   before. */
export default function CrewSignInKiosk({ jsa, upd, onExit, onSign, signedCount: signedCountProp }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const lastPointRef = useRef(null);
  const activeTouchIdRef = useRef(null);

  const [padWidth, setPadWidth] = useState(320);
  const [padHeight, setPadHeight] = useState(padHeightFor(320));
  const [hasStroke, setHasStroke] = useState(false);
  const [phase, setPhase] = useState('signing'); // 'signing' | 'confirmed' | 'confirmingExit'

  // Belt-and-suspenders alongside .crewKiosk's own touch-action:none --
  // locks the page itself so it can't scroll/bounce behind the fixed
  // overlay while this kiosk is up (Fonzo, field report 2026-08-19: people
  // having trouble hitting Confirm because "the screen is movable").
  useEffect(() => {
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevTouchAction = body.style.touchAction;
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.touchAction = prevTouchAction;
    };
  }, []);

  const signedCount = typeof signedCountProp === 'number' ? signedCountProp : (jsa.crewSignatures?.length || 0);
  const currentNumber = signedCount + 1;

  // Header number deliberately does NOT track currentNumber live -- during
  // the 'confirmed' overlay, currentNumber has already bumped to the NEXT
  // signer (crewSignatures grew the instant upd() ran), which would show
  // "Sign Here — #2" behind a "Signed, pass it along" message for #1 still
  // on screen. Holding headerNumber back until phase returns to 'signing'
  // means the header and the blank pad flip to the next signer together, in
  // one beat, instead of the header jumping ahead early (Fonzo's call,
  // 2026-08-14).
  const [headerNumber, setHeaderNumber] = useState(currentNumber);
  useEffect(() => {
    if (phase === 'signing') setHeaderNumber(currentNumber);
  }, [phase, currentNumber]);

  useEffect(() => {
    function computeWidth() {
      const w = wrapRef.current ? wrapRef.current.clientWidth : 320;
      const width = Math.max(280, Math.min(900, w || 320));
      setPadWidth(width);
      setPadHeight(padHeightFor(width));
    }
    computeWidth();
    window.addEventListener('resize', computeWidth);
    return () => window.removeEventListener('resize', computeWidth);
  }, []);

  // Re-inits a blank canvas every time we advance to a new signer number
  // (currentNumber bumps once upd() flows crewSignatures back down as a
  // prop) -- this is what actually clears the pad between people, not a
  // manual clearRect after confirming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = padWidth * dpr;
    canvas.height = padHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0B1D2E';
    hasStrokeRef.current = false;
    setHasStroke(false);
  }, [padWidth, padHeight, currentNumber]);

  function toCanvasPoint(clientX, clientY) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? padWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? padHeight / rect.height : 1;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function beginStrokeAt(point) {
    drawingRef.current = true;
    lastPointRef.current = point;
    hasStrokeRef.current = true;
    setHasStroke(true);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
  function continueStrokeTo(point) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const last = lastPointRef.current || point;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }
  function endStroke() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function pointerDown(e) {
    if (e.pointerType === 'touch' || phase !== 'signing') return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    beginStrokeAt(toCanvasPoint(e.clientX, e.clientY));
  }
  function pointerMove(e) {
    if (e.pointerType === 'touch' || phase !== 'signing') return;
    if (!drawingRef.current) return;
    e.preventDefault();
    continueStrokeTo(toCanvasPoint(e.clientX, e.clientY));
  }
  function pointerUp(e) {
    if (e.pointerType === 'touch') return;
    endStroke();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    function findActiveTouch(list) {
      if (activeTouchIdRef.current == null) return null;
      for (let i = 0; i < list.length; i += 1) if (list[i].identifier === activeTouchIdRef.current) return list[i];
      return null;
    }
    function onTouchStart(e) {
      if (phase !== 'signing') return;
      e.preventDefault();
      if (activeTouchIdRef.current != null) return;
      const t = e.changedTouches[0];
      activeTouchIdRef.current = t.identifier;
      beginStrokeAt(toCanvasPoint(t.clientX, t.clientY));
    }
    function onTouchMove(e) {
      const t = findActiveTouch(e.touches);
      if (!t) return;
      e.preventDefault();
      continueStrokeTo(toCanvasPoint(t.clientX, t.clientY));
    }
    function onTouchEnd(e) {
      const t = findActiveTouch(e.changedTouches);
      if (!t) return;
      endStroke();
      activeTouchIdRef.current = null;
    }
    function onTouchCancel() {
      endStroke();
      activeTouchIdRef.current = null;
    }
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchCancel, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [phase, padWidth, currentNumber]);

  function clearCurrent() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    setHasStroke(false);
  }

  function confirmSignature() {
    if (!hasStrokeRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    if (onSign) {
      // Deliberately not awaited: the man in front of the iPad should not
      // wait on a network round trip to hand it to the next guy.
      onSign(dataUrl);
    } else {
      const next = [...(jsa.crewSignatures || []), { dataUrl, signedAt: new Date().toISOString() }];
      upd({ crewSignatures: next });
    }
    setPhase('confirmed');
    window.setTimeout(() => setPhase('signing'), CONFIRM_PAUSE_MS);
  }

  // A plain tap into a "done signing?" choice, not a hold -- exiting isn't
  // a single accidental tap away, but this stays two ordinary taps rather
  // than a hold-and-drag gesture (the previous hold-to-exit fought iOS
  // Safari's own text-selection loupe in the field, 2026-08-17).
  function requestExit() { setPhase('confirmingExit'); }
  function continueSigning() { setPhase('signing'); }
  function confirmDoneSigning() {
    upd({ signatureLineCount: EXTRA_BLANK_LINES_AFTER_SIGNING });
    onExit();
  }

  return (
    <div className="crewKiosk" role="dialog" aria-modal="true" aria-label="Crew sign-in">
      <button
        type="button"
        className="crewKioskExitHold"
        onClick={requestExit}
        aria-label="End sign-in"
        title="End sign-in"
      >
        <span className="crewKioskExitHoldLabel">End Sign-In</span>
      </button>

      {phase === 'confirmingExit' && (
        <div className="crewKioskExitConfirmOverlay" role="alertdialog" aria-modal="true" aria-label="Done signing?">
          <div className="crewKioskExitConfirmPanel">
            <h2>Done Signing?</h2>
            <p>{signedCount} crew member{signedCount === 1 ? '' : 's'} signed. 20 blank lines will be added after them for anyone who signs in ink later.</p>
            <div className="crewKioskExitConfirmActions">
              <button type="button" className="btn ghost lg" onClick={continueSigning}>Continue Signing</button>
              <button type="button" className="btn primary lg" onClick={confirmDoneSigning}>Done Signing</button>
            </div>
          </div>
        </div>
      )}

      <div className="crewKioskBody">
        <div className="crewKioskHead">
          <span className="crewKioskEyebrow">Crew Sign-In</span>
          <h1 className="crewKioskNumber">Sign Here — #{headerNumber}</h1>
          <p className="crewKioskHint">Sign your name below, then tap Confirm &amp; Next.</p>
        </div>
        {/* The canvas stays mounted across both phases on purpose -- when it
            was conditionally rendered only during 'signing', switching to
            the 'confirmed' branch unmounted it, and remounting later left a
            brand-new canvas element whose width/height/context never got
            re-initialized by the reset effect (which only re-runs when
            padWidth/currentNumber change, not on remount) -- confirmed by
            Playwright testing: signer 2's Confirm button stayed enabled
            because hasStrokeRef never actually got cleared onto a real
            canvas. Keeping one persistent canvas node and overlaying the
            confirmation on top of it instead fixes that at the root. */}
        <div className="crewKioskPadWrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="crewKioskCanvas"
            style={{ width: padWidth, height: padHeight, touchAction: 'none' }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
          />
          {/* Used to also show "Signed" / "Pass it to the next person" text,
              but the pad got shorter when it was reshaped to match the
              printed box (see SIG_BOX_RATIO above), and that text no longer
              fit without clipping. Just the checkmark now (Fonzo,
              2026-08-17) -- it still reads as "done" at a glance, and fits
              comfortably at any pad height. */}
          {phase === 'confirmed' && (
            <div className="crewKioskConfirmedOverlay" aria-label="Signed">
              <div className="crewKioskCheck" aria-hidden="true">&#10003;</div>
            </div>
          )}
        </div>
        <div className="crewKioskActions">
          <button type="button" className="btn ghost lg" disabled={phase !== 'signing'} onClick={clearCurrent}>Clear</button>
          <button type="button" className="btn primary lg crewKioskConfirm" disabled={phase !== 'signing' || !hasStroke} onClick={confirmSignature}>
            Confirm &amp; Next
          </button>
        </div>
      </div>

      <div className="crewKioskFooter">{signedCount} signed so far</div>
    </div>
  );
}
