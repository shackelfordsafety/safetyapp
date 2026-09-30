import { Component, Suspense } from 'react';

/* ── A safety net around one lazily loaded part of the app ──────────────
   Every screen that arrives on demand (the four HR forms, My Work, the
   board, Records, the account cards in Settings) used to have only the
   app-wide crash screen above it. So when one of them could not load --
   most often simply no signal the first time it was opened after an
   update -- the WHOLE app was replaced by "Something went wrong", the JSA
   being written included.

   This keeps a failure to the part that failed, says what almost always
   caused it, and offers the one thing that fixes it. Reloading is safe:
   every form saves itself to the device within a second, and flushes on
   the way out. Found in the 2026-09-30 audit. */
class SectionBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('A section of the app failed to load:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.quiet) return null;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <div className="card" role="alert" style={{ margin: '16px 0' }}>
        <div className="cardBody">
          <strong>This part of the app didn&apos;t load.</strong>
          <p className="helperText" style={{ marginTop: 6 }}>
            {offline
              ? 'It needs a signal the first time it is opened. Connect, then tap Try again. Everything else still works, and your paperwork is saved.'
              : 'Tap Try again. Your paperwork is saved on this device.'}
          </p>
          <button type="button" className="btn primary sm" style={{ marginTop: 8 }} onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/* Drop-in for <Suspense>: same props, plus `quiet` to show nothing at all
   on failure (for optional cards that are not worth a warning). */
export default function SafeSuspense({ fallback = null, quiet = false, children }) {
  return (
    <SectionBoundary quiet={quiet}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </SectionBoundary>
  );
}
