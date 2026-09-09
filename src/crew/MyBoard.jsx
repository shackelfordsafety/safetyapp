import { useCallback, useEffect, useState } from 'react';
import { fetchMyBoard, fetchSigners, NotSignedInError } from './board';
import JsaContents from './JsaContents';
import './myboard.css';

/* ── The superintendent's own board ──────────────────────────────────────
   What he looks at while the crew signs. The number is the point: standing
   in front of 50 men at 6:35, "43 signed" is the difference between
   starting work and guessing.

   Same data the crew reads through the QR, from the other side. Lazy
   loaded, so none of it reaches a device that only ever builds JSAs. */

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* What was actually published, as the crew sees it. Same component the
   crew sign-in page uses, so the two can never show different things about
   the same document. */
function JsaPreview({ row, onClose }) {
  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Published JSA" style={{ maxWidth: 620, maxHeight: '88vh', overflowY: 'auto' }}>
        <h3 style={{ margin: 0 }}>{row.area_label}</h3>
        <p className="helperText">
          This is exactly what a crew member reads before signing.
          {row.version > 1 ? ` Version ${row.version}.` : ''}
        </p>
        <JsaContents jsa={row.data} title="Published JSA" />
        <div className="dialogActions">
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SignerList({ publicationId, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchSigners(publicationId)
      .then(r => { if (alive) setRows(r); })
      .catch(e => { if (alive) setError(e?.message || 'Could not load the list.'); });
    return () => { alive = false; };
  }, [publicationId]);

  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Who signed" style={{ maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ margin: 0 }}>Who signed</h3>
        {error && <p className="archiveError">{error}</p>}
        {!rows && !error && <p className="helperText">Loading…</p>}
        {rows && rows.length === 0 && <p className="helperText">Nobody yet.</p>}
        {rows && rows.length > 0 && (
          <ol className="brdSigners">
            {rows.map((s, i) => (
              <li key={s.id}>
                <span className="brdSignerNum">{i + 1}</span>
                <span className="brdSignerName">
                  {/* The kiosk records no name on purpose -- it is numbered
                      only. An unnamed row is a man who signed on the iPad,
                      not a missing record. */}
                  {s.signer_name || <em>Signed on the iPad</em>}
                </span>
                <span className="brdSignerTime">
                  {fmtTime(s.signed_at)}{s.is_late ? ' · late' : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="dialogActions">
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function MyBoard() {
  const [state, setState] = useState({ status: 'loading', rows: [], boardUrl: '' });
  const [error, setError] = useState('');
  const [openList, setOpenList] = useState(null);
  const [preview, setPreview] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { rows, boardUrl } = await fetchMyBoard();
      setState({ status: 'ready', rows, boardUrl });
    } catch (ex) {
      if (ex instanceof NotSignedInError || ex?.name === 'NotSignedInError') {
        setState(s => ({ ...s, status: 'signedout' }));
        return;
      }
      setError(ex?.message || 'Could not load your board.');
      setState(s => ({ ...s, status: 'error' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The count is the whole point of this screen, so it keeps itself fresh
  // rather than making him pull to refresh while men are signing.
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [state.status, load]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(state.boardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (state.status === 'signedout') {
    return (
      <div className="page">
        <div className="brdEmpty">
          <strong>Sign in to see your board</strong>
          <span>Use the button at the top right. Building JSAs never needs a login — this does.</span>
        </div>
      </div>
    );
  }

  const live = state.rows.filter(r => r.live);
  const done = state.rows.filter(r => !r.live);

  return (
    <div className="page">
      <div className="brdHead">
        <div>
          <h2>My Board</h2>
          <p>What your crew sees when they scan. Updates on its own.</p>
        </div>
        <button type="button" className="btn ghost sm" onClick={load}>Refresh</button>
      </div>

      {error && <div className="archiveError">{error}</div>}

      {state.status === 'loading' && <p className="helperText">Loading…</p>}

      {state.status === 'ready' && state.rows.length === 0 && (
        <div className="brdEmpty">
          <strong>Nothing published today</strong>
          <span>Finish a JSA and hit “Publish to my board” on the last step. It shows up here and the crew can scan for it.</span>
        </div>
      )}

      {live.map(r => (
        <div key={r.id} className="brdCard">
          {/* Tapping the row opens what was actually published -- the same
              view the crew reads. Checking "did I put the right one up?"
              without walking outside to scan your own QR. */}
          <button type="button" className="brdCardMain" onClick={() => setPreview(r)}>
            <strong>{r.area_label}</strong>
            <span className="brdMeta">
              Published {fmtTime(r.published_at)} · good until {fmtTime(r.expires_at)}
              {r.version > 1 ? ` · version ${r.version}` : ''}
            </span>
            <span className="brdSeeDoc">See the JSA</span>
          </button>
          <button type="button" className="brdCount" onClick={() => setOpenList(r.id)}>
            <span className="brdCountNum">{r.signed}</span>
            <span className="brdCountLabel">signed</span>
          </button>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <div className="brdSectionTitle">Finished today</div>
          {done.map(r => (
            <div key={r.id} className="brdCard done">
              <button type="button" className="brdCardMain" onClick={() => setPreview(r)}>
                <strong>{r.area_label}</strong>
                <span className="brdMeta">Expired {fmtTime(r.expires_at)}</span>
                <span className="brdSeeDoc">See the JSA</span>
              </button>
              <button type="button" className="brdCount" onClick={() => setOpenList(r.id)}>
                <span className="brdCountNum">{r.signed}</span>
                <span className="brdCountLabel">signed</span>
              </button>
            </div>
          ))}
        </>
      )}

      {state.status === 'ready' && (
        <div className="brdLink">
          <span className="brdSectionTitle">Your board link</span>
          <p className="helperText">
            This never changes. It is what the QR code points at — print it once and it
            works forever. Lost the sticker? Show this screen and let them scan it.
          </p>
          <code className="brdUrl">{state.boardUrl}</code>
          <button type="button" className="btn ghost sm" onClick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}

      {preview && <JsaPreview row={preview} onClose={() => setPreview(null)} />}
      {openList && <SignerList publicationId={openList} onClose={() => setOpenList(null)} />}
    </div>
  );
}
