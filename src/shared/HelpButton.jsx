import { useEffect, useRef, useState } from 'react';
import './helpButton.css';

/* ── "What is this screen for?" ──────────────────────────────────────────
   A question mark next to a screen's heading that explains, in plain
   words, what the page does and what to do next.

   Fonzo asked for this after watching real men use the app: several of
   them stopped and asked a person rather than reading the screen. The men
   using this skew older and are not tech people, and the ones who get
   stuck are the least likely to say so -- they just stop using it.

   NOT a guided tour, deliberately. A tour is skipped by most people, and
   this app changes weekly -- the navigation, the sign-in flow and the
   finish step all moved in one week. A tour written today would be lying
   by Friday, and nobody maintains two apps. Help that sits ON the screen
   it describes goes stale far more visibly, and is one edit away from
   being right again.

   Written to be read out loud to somebody. Short sentences, no jargon,
   and it says what to DO, not what the feature is called. */

export default function HelpButton({ title, children }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);

  // Escape closes it, and focus lands somewhere useful when it opens --
  // this is the screen for people who are already unsure.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="helpBtn"
        onClick={() => setOpen(true)}
        aria-label={`What is ${title} for?`}
      >
        ?
      </button>

      {open && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dialogPanel helpPanel" role="dialog" aria-modal="true" aria-label={`About ${title}`}>
            <div className="helpPanelHead">
              <span className="helpEyebrow">What this is</span>
              <h3>{title}</h3>
            </div>
            <div className="helpBody">{children}</div>
            <div className="dialogActions">
              <button type="button" className="btn primary" ref={closeRef} onClick={() => setOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
