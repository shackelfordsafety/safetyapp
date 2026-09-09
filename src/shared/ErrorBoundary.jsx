import { Component } from 'react';

/* ── The last line of defense ────────────────────────────────────────────
   React unmounts the entire tree when a render throws. With nothing to
   catch it, this app goes WHITE -- no message, no button, no way back --
   and that has really happened here more than once during development.

   On a desk that is an annoyance. In a gravel lot at 6:15am with fifty men
   waiting on a tailgate meeting it is a safety-process failure, which is
   exactly what this project's priority list says to prevent first. So:
   catch the crash, say something a human can act on, and give a way out.

   Deliberately dependency-free and inline-styled. A boundary that needs
   the stylesheet, a token, or another component to render is a boundary
   that can fail at the one moment it matters. Everything it needs is in
   this file.

   The escape hatch (second reload onwards) exists because the most likely
   poison is the saved draft itself -- a value of the wrong shape read back
   out of localStorage crashes on every render, so plain "reload" would
   loop forever and the device would be bricked for that user. Setting the
   drafts aside breaks the loop. It never deletes: everything is copied to
   a timestamped backup key first, so a document is always recoverable off
   the device afterwards. */

const RELOADED_FLAG = 'sdc.crashReload.v1';

/* Everything this app reads back out of storage and renders. An earlier
   version of this list held only the drafts, on the theory that templates
   were old and simple enough to trust -- but a hatch that cannot clear the
   thing that is actually poisoned is not an escape hatch, and a bad
   template list crashes the Home screen just as dead as a bad draft. So
   the rule is now: if a render reads it, this can set it aside. Nothing is
   ever deleted, only renamed, so "set aside" really is reversible. */
const RESCUE_KEYS = [
  'sdc.jsa.draft.v4',
  'sdc.incident.draft.v1',
  'sdc.discipline.draft.v1',
  'sdc.medical.draft.v1',
  'sdc.separation.draft.v1',
  'sdc.uncontrolled.draft.v1',
  'sdc.jsa.templates.v1',
  'sdc.incident.records.v1',
  'sdc.settings.v2',
];

const S = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#F7F7F8',
    color: '#17181A',
    font: '16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    background: '#fff',
    border: '1px solid #DEDEE1',
    borderRadius: '14px',
    padding: '28px 24px',
    boxShadow: '0 2px 14px rgba(0,0,0,.06)',
  },
  bar: { height: '6px', background: '#C1121F', borderRadius: '3px', marginBottom: '22px' },
  h1: { margin: '0 0 10px', fontSize: '24px', lineHeight: 1.2, fontWeight: 700 },
  p: { margin: '0 0 14px', fontSize: '16.5px' },
  strongLine: { margin: '0 0 20px', fontSize: '16.5px', fontWeight: 600 },
  btn: {
    display: 'block',
    width: '100%',
    padding: '15px 18px',
    fontSize: '17px',
    fontWeight: 600,
    color: '#fff',
    background: '#C1121F',
    border: '1px solid #C1121F',
    borderRadius: '10px',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  ghost: {
    display: 'block',
    width: '100%',
    padding: '13px 18px',
    fontSize: '15.5px',
    fontWeight: 600,
    color: '#17181A',
    background: '#fff',
    border: '1px solid #DEDEE1',
    borderRadius: '10px',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  fine: { margin: '4px 0 0', fontSize: '13.5px', color: '#6B6B72' },
  details: { marginTop: '20px', fontSize: '13px', color: '#6B6B72' },
  pre: {
    marginTop: '8px',
    padding: '10px',
    background: '#F2F2F4',
    border: '1px solid #DEDEE1',
    borderRadius: '8px',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '180px',
    overflow: 'auto',
  },
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, rescued: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Nowhere to report to -- this app has no backend and often no signal.
    // The console is what Fonzo can actually read back to me over the phone.
    console.error('Safety Documentation Center crashed:', error, info?.componentStack);
  }

  hasReloadedBefore() {
    try { return sessionStorage.getItem(RELOADED_FLAG) === '1'; } catch { return false; }
  }

  reload = () => {
    try { sessionStorage.setItem(RELOADED_FLAG, '1'); } catch { /* private mode */ }
    window.location.reload();
  };

  /* Copy first, then clear. If the copy throws (quota, private mode) the
     original is still sitting there untouched. */
  rescue = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      RESCUE_KEYS.forEach((key) => {
        const value = localStorage.getItem(key);
        if (value === null) return;
        localStorage.setItem(`${key}.broken.${stamp}`, value);
        localStorage.removeItem(key);
      });
      try { sessionStorage.removeItem(RELOADED_FLAG); } catch { /* private mode */ }
      this.setState({ rescued: true });
    } catch {
      this.setState({ rescued: false, rescueFailed: true });
    }
  };

  render() {
    const { error, rescued, rescueFailed } = this.state;
    if (!error) return this.props.children;

    if (rescued) {
      return (
        <div style={S.wrap}>
          <div style={S.card}>
            <div style={S.bar} />
            <h1 style={S.h1}>Set aside. Open it again.</h1>
            <p style={S.p}>
              The document that was causing the problem has been put to one side. It is not deleted —
              it is still on this device and can be pulled back off it.
            </p>
            <p style={S.strongLine}>Close this tab and open the app again.</p>
            <button type="button" style={S.btn} onClick={() => window.location.reload()}>
              Open it now
            </button>
          </div>
        </div>
      );
    }

    const stuck = this.hasReloadedBefore();

    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <div style={S.bar} />
          <h1 style={S.h1}>Something went wrong</h1>
          <p style={S.p}>
            The app hit a problem and stopped. This is the app’s fault, not anything you did.
          </p>
          <p style={S.strongLine}>Your work is saved on this device.</p>

          <button type="button" style={S.btn} onClick={this.reload}>
            Reload the app
          </button>

          {stuck && (
            <>
              <button type="button" style={S.ghost} onClick={this.rescue}>
                Still broken — set the current document aside
              </button>
              <p style={S.fine}>
                Use this only if reloading keeps landing you back here. It moves what you were
                working on out of the way so the app can start again. Nothing is deleted — it is
                all still on this device and can be pulled back off it.
              </p>
            </>
          )}

          {rescueFailed && (
            <p style={S.fine}>
              That didn’t work on this device. Close the tab, open the app again, and tell Fonzo.
            </p>
          )}

          <details style={S.details}>
            <summary>Details (for Fonzo)</summary>
            <pre style={S.pre}>{String(error?.stack || error?.message || error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
