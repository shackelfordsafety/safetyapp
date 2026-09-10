import { useEffect, useRef, useState } from 'react';
import { useLocked } from '../documents/lockedContext';

/* Reusable signature capture. Draws on a canvas at a fixed internal
   resolution (scaled by devicePixelRatio for crisp strokes), stores the
   result as a compact transparent-background PNG data URL.

   Deliberately modal-ish (view mode vs. edit mode) rather than "always
   live" -- on a touch device a stray drag across a saved signature would
   otherwise silently destroy it, which is unacceptable for a safety
   document. Nothing is ever auto-saved; the user must press Save. */
// Minimum usable drawing height for a normal handwritten first-and-last
// name: roomy enough on a desktop/tablet form container (160-180px target),
// a touch shorter on a phone-width viewport (135-150px target) where
// vertical space is scarcer -- see the v0.1.4 polish pass. Width is always
// measured live from the actual form container instead of a fixed 320px, so
// the pad genuinely uses the available width up to a sane cap rather than
// leaving unused space next to it on wide layouts.
const PAD_HEIGHT_DESKTOP = 170;
const PAD_HEIGHT_PHONE = 145;
const PAD_WIDTH_MIN = 260;
const PAD_WIDTH_MAX = 640;
const PHONE_BREAKPOINT_PX = 480;

/* autoOpen / commitOnStroke exist for ONE screen: the crew sign-in page.

   Signing there used to cost four taps -- type your name, tap "Add
   signature", draw, tap "Save", tap "Finish" -- for a man standing in a
   gravel lot at 6:30am on a cracked phone. Every one of those taps is a
   place to give up, and on the first real night this went out, nobody
   signed at all.

   Both default to false, so the six office documents keep the deliberate
   tap-to-open behaviour described above: on those, a signature is captured
   once by someone sitting down, and a stray drag wiping it is the failure
   that matters. On the crew page nothing is at risk -- there is no saved
   signature to destroy, the man is on the screen for ten seconds, and the
   only failure that matters is him walking away unsigned. */
export default function SignaturePad({ value, onChange, label, disabled, autoOpen = false, commitOnStroke = false }) {
  const locked = useLocked();
  const [editing, setEditing] = useState(() => Boolean(autoOpen && !value));
  const [padSize, setPadSize] = useState({ width: 320, height: PAD_HEIGHT_DESKTOP });
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const lastPointRef = useRef(null);
  // Identifier of the single finger currently drawing, or null. Only this
  // Touch is tracked on touchmove/touchend -- a second finger landing on the
  // pad mid-stroke is ignored rather than corrupting the signature.
  const activeTouchIdRef = useRef(null);

  /* Measures the real available width from the wrapper (a block-level div
     that stretches to the form container, see .signaturePad in
     incident.css) rather than assuming a fixed 320px -- so the pad genuinely
     fills the form on desktop/tablet/phone alike. Recomputed on window
     resize (e.g. iPad rotation) too, but only when nothing has been drawn
     yet (hasStrokeRef) -- resizing the canvas element always clears its
     bitmap, and silently wiping an in-progress signature on an orientation
     change would be a real data-loss bug for a safety document. */
  useEffect(() => {
    if (!editing) return;
    function computeSize() {
      if (hasStrokeRef.current) return;
      const containerWidth = wrapRef.current ? wrapRef.current.clientWidth : 320;
      const width = Math.max(PAD_WIDTH_MIN, Math.min(PAD_WIDTH_MAX, containerWidth || PAD_WIDTH_MIN));
      const height = window.innerWidth <= PHONE_BREAKPOINT_PX ? PAD_HEIGHT_PHONE : PAD_HEIGHT_DESKTOP;
      setPadSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    }
    computeSize();
    window.addEventListener('resize', computeSize);
    return () => window.removeEventListener('resize', computeSize);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = padSize.width * dpr;
    canvas.height = padSize.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    hasStrokeRef.current = false;
  }, [editing, padSize.width, padSize.height]);

  /* The canvas's internal drawing coordinate space is always padSize.width x
     padSize.height (ctx.scale(dpr, dpr) already normalizes for
     devicePixelRatio -- see the editing effect above), but the canvas's
     actual rendered box can differ slightly from that due to sub-pixel
     layout rounding. Without rescaling, a stroke drawn across the full
     *displayed* width could drift from the internal coordinate space. Scaling
     by the ratio of internal-to-rendered size keeps input coordinates
     correct at any responsive width. Shared by both the pointer (mouse/pen)
     and native touch (finger) input paths below. */
  function toCanvasPoint(clientX, clientY) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? padSize.width / rect.width : 1;
    const scaleY = rect.height > 0 ? padSize.height / rect.height : 1;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  // Shared stroke math for both input paths. A tap alone (down, then up
  // with no move) leaves a small dot rather than nothing -- for a signature
  // pad, a mark that never moved should still look like a mark, not vanish.
  function beginStrokeAt(point) {
    drawingRef.current = true;
    lastPointRef.current = point;
    hasStrokeRef.current = true;
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
    hasStrokeRef.current = true;
  }

  function endStroke() {
    drawingRef.current = false;
    lastPointRef.current = null;
    /* Hand the mark up the moment the finger lifts, so there is no Save
       button standing between a man and being signed in. He can keep
       drawing -- each lift just replaces it with the fuller version. */
    if (commitOnStroke && hasStrokeRef.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  }

  /* Pointer Events own mouse/pen input only. Real finger input is handled
     exclusively by the native touchstart/touchmove/touchend/touchcancel
     listeners below (see the touch effect) -- a touch gesture always fires
     both event families, so processing pointerType 'touch' here too would
     draw every finger stroke twice. */
  function pointerDown(e) {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    canvas.setPointerCapture?.(e.pointerId);
    beginStrokeAt(toCanvasPoint(e.clientX, e.clientY));
  }

  function pointerMove(e) {
    if (e.pointerType === 'touch') return;
    if (!drawingRef.current) return;
    e.preventDefault();
    continueStrokeTo(toCanvasPoint(e.clientX, e.clientY));
  }

  function pointerUp(e) {
    if (e.pointerType === 'touch') return;
    endStroke();
  }

  /* Native touch input, bound directly to the canvas DOM node (not React's
     synthetic touch handlers, which React registers passively by default --
     see addTrappedEventListener in react-dom -- making preventDefault() on
     touchmove a silent no-op there). passive: false here is what actually
     lets preventDefault stop Safari from panning the page while signing. */
  useEffect(() => {
    if (!editing) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    function findActiveTouch(touchList) {
      if (activeTouchIdRef.current == null) return null;
      for (let i = 0; i < touchList.length; i += 1) {
        if (touchList[i].identifier === activeTouchIdRef.current) return touchList[i];
      }
      return null;
    }

    function onTouchStart(e) {
      e.preventDefault();
      if (activeTouchIdRef.current != null) return; // already drawing with a finger; ignore extra fingers
      const touch = e.changedTouches[0];
      activeTouchIdRef.current = touch.identifier;
      beginStrokeAt(toCanvasPoint(touch.clientX, touch.clientY));
    }

    function onTouchMove(e) {
      const touch = findActiveTouch(e.touches);
      if (!touch) return;
      e.preventDefault();
      continueStrokeTo(toCanvasPoint(touch.clientX, touch.clientY));
    }

    function onTouchEnd(e) {
      const touch = findActiveTouch(e.changedTouches);
      if (!touch) return;
      endStroke();
      activeTouchIdRef.current = null;
    }

    function onTouchCancel() {
      // Reset unconditionally (not gated on matching changedTouches) so an
      // interrupted gesture can never leave drawing stuck mid-stroke.
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
  }, [editing, padSize.width, padSize.height]);

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    // Clearing has to un-commit too, or the submit button would still be
    // holding the signature the user just wiped off the screen.
    if (commitOnStroke) onChange(null);
  }

  function startEdit() {
    if (locked) return; // a finished document's signatures can't be replaced/removed
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function saveSignature() {
    if (!hasStrokeRef.current) {
      setEditing(false);
      return;
    }
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onChange(dataUrl);
    setEditing(false);
  }

  function removeSignature() {
    if (locked) return;
    onChange(null);
  }

  if (disabled) {
    return (
      <div className="signaturePad">
        {label ? <div className="fieldLabel">{label}</div> : null}
        <div className="signaturePreview signaturePreviewEmpty">Not applicable</div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="signaturePad">
        {label ? <div className="fieldLabel">{label}</div> : null}
        {value ? (
          <div className="signaturePreviewWrap">
            <img src={value} alt="Signature" className="signaturePreview" />
            {!locked && (
              <div className="signaturePadActions">
                <button type="button" className="btn secondary sm" onClick={startEdit}>Replace</button>
                <button type="button" className="btn ghost sm" onClick={removeSignature}>Remove</button>
              </div>
            )}
          </div>
        ) : locked ? (
          <div className="signaturePreview signaturePreviewEmpty">No signature</div>
        ) : (
          <button type="button" className="btn secondary sm" onClick={startEdit}>Add signature</button>
        )}
      </div>
    );
  }

  return (
    <div className="signaturePad">
      {label ? <div className="fieldLabel">{label}</div> : null}
      <div className="signatureCanvasWrap" ref={wrapRef}>
        {/* Pointer handlers below cover mouse/pen only (see pointerDown) --
            finger input is drawn by the native touch listeners attached in
            the effect above. No onPointerLeave: with setPointerCapture in
            place, pointerup already reaches this element no matter where
            the pointer is released; onPointerCancel resets cleanly instead
            of leaving drawingRef stuck true on an interrupted gesture. */}
        <canvas
          ref={canvasRef}
          className="signatureCanvas"
          style={{ width: padSize.width, height: padSize.height, touchAction: 'none' }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
      </div>
      {/* With commitOnStroke the mark is already handed up as it's drawn,
          so Save would be a button that does nothing and Cancel would be a
          second way to say Clear. Only the one that still means something
          is shown. */}
      <div className="signaturePadActions">
        <button type="button" className="btn ghost sm" onClick={clearCanvas}>Clear</button>
        {!commitOnStroke && (
          <>
            <button type="button" className="btn ghost sm" onClick={cancelEdit}>Cancel</button>
            <button type="button" className="btn primary sm" onClick={saveSignature}>Save</button>
          </>
        )}
      </div>
    </div>
  );
}
