import { useCallback, useEffect, useState } from 'react';
import { fetchMyBoard, fetchSigners, signOnKiosk, takeDownPublication, describeWindow, NotSignedInError } from './board';
import CrewSignInKiosk from '../jsa/CrewSignInKiosk';
import BoardQr from './BoardQr';
import { signedUrlFor } from '../archive/fileToArchive';
import JsaContents from './JsaContents';
import './myboard.css';
import HelpButton from '../shared/HelpButton';
import { queueSignature, flushSignatures, pendingCount } from './signatureQueue';

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
                      only. An unnamed row is a man who signed on the supervisor's device,
                      not a missing record. */}
                  {s.signer_name || <em>Signed in person</em>}
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
  const [opening, setOpening] = useState('');
  // What the printed sticker says under the code, so a trailer with more
  // than one board posted stays tellable apart.
  const [kiosk, setKiosk] = useState(null);
  const [kioskSigned, setKioskSigned] = useState(0);
  /* Signatures held on this device that the database has not accepted yet.
     Shown, never hidden -- see signatureQueue.js. */
  const [kioskPending, setKioskPending] = useState(0);
  const [kioskError, setKioskError] = useState("");
  const [takingDown, setTakingDown] = useState(null);
  const [removing, setRemoving] = useState('');

  async function confirmTakeDown() {
    const row = takingDown;
    setTakingDown(null);
    setRemoving(row.id);
    setError('');
    try {
      await takeDownPublication(row.id);
      await load();
    } catch (ex) {
      setError(ex?.message || 'Could not take it down.');
      await load();
    } finally {
      setRemoving('');
    }
  }

  /* Kiosk mode for one posting: the iPad in the trailer, for the handful
     of men with no phone on them. They scrawl and walk off -- no name,
     deliberately -- and it lands in the same place a phone signature
     does. Not awaited, so nobody waits on the network holding the iPad;
     the board reloads when he closes it. */
  async function signOnPad(dataUrl) {
    /* Held on the device BEFORE anything is attempted. The old version
       counted it up and fired the upload with the error swallowed, so a
       failed save looked exactly like a successful one to the man who had
       just signed -- he watched the number go up and walked off. */
    const held = queueSignature({
      publicationId: kiosk.id,
      signatureData: dataUrl,
      expiresAt: kiosk.expires_at,
    });
    if (!held) {
      setKioskError('This iPad is out of room and could not hold that signature. Sign the paper sheet instead.');
      return;
    }
    setKioskSigned(n => n + 1);
    setKioskPending(pendingCount());
    await sendQueuedSignatures();
  }

  /* Empties the queue and reports honestly. Anything that will not go --
     no signal, or a JSA that expired while the iPad sat open -- is counted
     on screen rather than hidden, because a superintendent can only decide
     to fall back to paper if somebody tells him. */
  async function sendQueuedSignatures() {
    const { stuck } = await flushSignatures(entry => signOnKiosk({
      publicationId: entry.publicationId,
      signatureData: entry.signatureData,
      expiresAt: entry.expiresAt,
    }));
    setKioskPending(pendingCount());
    setKioskError(stuck > 0 && pendingCount() > 0
      ? `${pendingCount()} signature${pendingCount() === 1 ? '' : 's'} still waiting to send. Keep this open until they clear, or sign the paper sheet.`
      : '');
  }

  /* Tapping a row opens the JSA as it was actually published -- the real
     PDF, not a readable summary of it. Publications made before PDFs were
     stored (or where generation failed) fall back to the reader rather than
     doing nothing. */
  async function openDoc(row) {
    if (!row.pdf_path) { setPreview(row); return; }
    setOpening(row.id);
    setError('');
    try {
      const url = await signedUrlFor(row.pdf_path);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (ex) {
      setError(ex?.message || 'Could not open it. Check your connection.');
    } finally {
      setOpening('');
    }
  }

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

  /* Anything the last session could not send gets another go the moment
     this screen opens. A signature queued in a dead zone on Tuesday should
     not still be sitting on the iPad on Friday because nobody reopened the
     kiosk -- the superintendent opens his board every morning. */
  useEffect(() => {
    if (pendingCount() > 0) sendQueuedSignatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="titleWithHelp">
            <h2>Sign-In</h2>
            <HelpButton title="Sign-In">
              <p>
                This is what your crew sees when they scan the code on your trailer.
              </p>
              <p>
                Finish a JSA and choose <strong>&ldquo;On their phones&rdquo;</strong> and it shows up
                here. The number next to it is how many people have signed. It counts up on its own —
                you don&apos;t have to refresh it.
              </p>
              <p><strong>What you can do here:</strong></p>
              <ul>
                <li><strong>Print it</strong> — the QR poster for your trailer. Print it once; it never changes.</li>
                <li><strong>Sign on this device</strong> — for anyone without a phone on them.</li>
                <li><strong>Tap the number</strong> — see who has signed.</li>
                <li><strong>Take it down</strong> — only while nobody has signed it yet.</li>
              </ul>
              <p>
                Your code is yours alone. Another superintendent&apos;s code shows his JSAs, not
                yours.
              </p>
            </HelpButton>
          </div>
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
          <button type="button" className="brdCardMain" onClick={() => openDoc(r)}>
            <strong>{r.area_label}</strong>
            <span className="brdMeta">
              Published {fmtTime(r.published_at)} · good until {describeWindow(r.expires_at)}
              {r.version > 1 ? ` · version ${r.version}` : ''}
            </span>
            <span className="brdSeeDoc">{opening === r.id ? 'Opening…' : 'See the JSA'}</span>
          </button>
          <div className="brdCardRight">
            <button type="button" className="brdCount" onClick={() => setOpenList(r.id)}>
              <span className="brdCountNum">{r.signed}</span>
              <span className="brdCountLabel">signed</span>
            </button>
            <button type="button" className="btn secondary sm" onClick={() => { setKiosk(r); setKioskSigned(0); }}>
              Sign on this iPad
            </button>
            {/* Only while nobody has signed. Once a man has signed, this
                is a record of who agreed to what and the button is gone --
                the fix from there is a corrected version, not an eraser. */}
            {r.signed === 0 && (
              <button
                type="button"
                className="brdTakeDown"
                onClick={() => setTakingDown(r)}
                disabled={removing === r.id}
              >
                {removing === r.id ? 'Taking it down…' : 'Take it down'}
              </button>
            )}
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <div className="brdSectionTitle">Finished today</div>
          {done.map(r => (
            <div key={r.id} className="brdCard done">
              <button type="button" className="brdCardMain" onClick={() => openDoc(r)}>
                <strong>{r.area_label}</strong>
                <span className="brdMeta">Expired {fmtTime(r.expires_at)}</span>
                <span className="brdSeeDoc">{opening === r.id ? 'Opening…' : 'See the JSA'}</span>
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
        <>
          <BoardQr url={state.boardUrl} />
          <div className="brdLink">
            <span className="brdSectionTitle">Or send the link</span>
            <p className="helperText">
              Same destination as the code above — useful before the sticker is up.
            </p>
            <code className="brdUrl">{state.boardUrl}</code>
            <button type="button" className="btn ghost sm" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </>
      )}

      {kiosk && (
        <>
          <CrewSignInKiosk
            jsa={kiosk.data}
            upd={() => {}}
            onSign={signOnPad}
            signedCount={kiosk.signed + kioskSigned}
            onExit={() => { setKiosk(null); load(); }}
          />
          {/* Above the kiosk, because the kiosk is full screen and this is
              the one thing that must not be missed: signatures this device
              is holding that the database has not taken yet. */}
          {(kioskPending > 0 || kioskError) && (
            <div className="sigPendingBar" role="alert">
              <strong>
                {kioskPending > 0
                  ? `${kioskPending} signature${kioskPending === 1 ? '' : 's'} not sent yet`
                  : 'Signature problem'}
              </strong>
              <span>{kioskError || 'Still trying. Keep this open until it clears.'}</span>
              <button type="button" className="btn secondary sm" onClick={sendQueuedSignatures}>Try again</button>
            </div>
          )}
        </>
      )}
      {takingDown && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setTakingDown(null); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Take it down" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: 0 }}>Take this off the board?</h3>
            <p className="helperText">
              <strong>{takingDown.area_label}</strong><br />
              Good until {describeWindow(takingDown.expires_at)}
            </p>
            <p className="helperText">
              Nobody has signed it, so nothing is lost. The crew will stop seeing it straight away.
              Your saved JSA on this device isn&apos;t touched — fix the times and publish it again.
            </p>
            <div className="dialogActions">
              <button type="button" className="btn ghost" onClick={() => setTakingDown(null)}>Leave it up</button>
              <button type="button" className="btn primary" onClick={confirmTakeDown}>Take it down</button>
            </div>
          </div>
        </div>
      )}
      {preview && <JsaPreview row={preview} onClose={() => setPreview(null)} />}
      {openList && <SignerList publicationId={openList} onClose={() => setOpenList(null)} />}
    </div>
  );
}
