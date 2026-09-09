import { useCallback, useEffect, useState } from 'react';
import SignaturePad from '../incident/SignaturePad';
import { fetchBoard, signPublication } from './board';
import JsaContents from './JsaContents';
import './crew.css';

/* The company mark. This page is the one outsiders actually see -- every
   crew member, and any client or safety inspector who gets handed a
   phone -- so it is the place branding earns its keep. Same asset the
   printed JSA carries. */
const LOGO = `${import.meta.env.BASE_URL}icons/shackelford-logo.webp`;

/* ── The crew sign-in page ───────────────────────────────────────────────
   What a man sees after scanning the QR on the trailer door. No account,
   no login, no app -- this renders INSTEAD of the whole application when
   the address is #/sign/<board owner>, so nothing else has to load.

   The flow, in Fonzo's own words:
     show up in the morning -> scan QR -> ask foreman where you're working
     -> click that area/JSA -> sign your name.

   READING COMES FIRST, SIGNING IS DELIBERATE (2026-09-09). Tapping an area
   used to land on a signing screen with the JSA above it. That is right at
   6:30am and wrong every other hour: Fonzo's guys carry no paper, so when a
   client or a safety inspector stops one and asks to see the JSA, this link
   is the answer -- and nobody wants to hand over a phone showing a
   signature pad. So a tap opens the document, and signing is one more tap
   underneath it. The same screen does both jobs and neither gets in the
   other's way.

   Built for a 50+ crew standing in a gravel lot at 6:30am on cracked
   phones in the sun: big targets, short words, high contrast, and the date
   and job stated plainly before anybody signs anything. */

const NAME_KEY = 'sdc.crew.name.v1';

function fmtDate(d) {
  if (!d) return '';
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d
    : parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function CrewSignIn({ boardOwnerId }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Same 50 guys every morning: after the first time, his name is already
  // filled in and signing is one tap. This is also what keeps typed names
  // from drifting -- a man typing his OWN name once gets it right.
  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY) || ''); } catch { /* private mode */ }
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      setRows(await fetchBoard(boardOwnerId));
      setStatus('ready');
    } catch (ex) {
      setError(ex?.message || 'Could not load the board. Check your signal and try again.');
      setStatus('error');
    }
  }, [boardOwnerId]);

  useEffect(() => { load(); }, [load]);

  function backToList() {
    setPicked(null);
    setSigning(false);
    setSignature('');
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!signature) { setError('Sign in the box before you finish.'); return; }
    setBusy(true);
    setError('');
    try {
      await signPublication({
        publicationId: picked.id,
        signerName: name,
        signatureData: signature,
        source: 'phone',
        expiresAt: picked.expires_at,
      });
      try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* private mode */ }
      setDone(true);
    } catch (ex) {
      setError(ex?.message || 'Could not record your signature. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="crewWrap">
        <div className="crewDone">
          <div className="crewBrandBar">
            <img src={LOGO} alt="Shackelford Construction and Hauling" />
          </div>
          <div className="crewCheck" aria-hidden="true">✓</div>
          <h1>You&apos;re signed in</h1>
          <p>{picked.area_label}</p>
          <p className="crewFine">{name.trim()} — {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          <button
            type="button"
            className="crewBtn ghost"
            onClick={() => { setDone(false); setSigning(false); }}
          >
            See the JSA again
          </button>
          <button
            type="button"
            className="crewBtn ghost"
            onClick={() => { setDone(false); backToList(); load(); }}
          >
            Back to the list
          </button>
        </div>
      </div>
    );
  }

  if (picked) {
    return (
      <div className="crewWrap">
        <div className="crewCard">
          <div className="crewBrandBar">
            <img src={LOGO} alt="Shackelford Construction and Hauling" />
          </div>
          <div className="crewConfirm">
            <span className="crewEyebrow">{picked.live ? 'Job Safety Analysis' : 'Closed'}</span>
            <h1>{picked.area_label}</h1>
            <p>{fmtDate(picked.doc_date)}{picked.job_site ? ` · ${picked.job_site}` : ''}</p>
            {picked.version > 1 && (
              <p className="crewRevised">Revised — version {picked.version}</p>
            )}
            {!picked.live && (
              <p className="crewLate">
                This one&apos;s finished for the day. You can still read it, but it can&apos;t be signed.
              </p>
            )}
          </div>

          <JsaContents jsa={picked.data} />

          {/* Signing is a deliberate second step, not the screen you land
              on -- see the header comment. */}
          {picked.live && !signing && (
            <button type="button" className="crewBtn primary" onClick={() => setSigning(true)}>
              Sign this one
            </button>
          )}

          {picked.live && signing && (
            <form className="crewSignForm" onSubmit={submit}>
              <label className="crewField">
                <span>Your name</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="First and last"
                  autoComplete="name"
                  required
                />
              </label>

              <SignaturePad label="Your signature" value={signature} onChange={setSignature} />

              {error && <p className="crewError">{error}</p>}

              <button type="submit" className="crewBtn primary" disabled={busy || !name.trim()}>
                {busy ? 'Signing…' : 'Finish'}
              </button>
            </form>
          )}

          <button type="button" className="crewBtn ghost" onClick={backToList}>
            {signing ? 'Not yet — go back' : 'Back to the list'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="crewWrap">
      <div className="crewCard">
          <div className="crewBrandBar">
            <img src={LOGO} alt="Shackelford Construction and Hauling" />
          </div>
        <span className="crewEyebrow">Job Safety Analysis</span>
        <h1>Where are you working?</h1>
        <p className="crewLead">Tap yours to read it. Ask your foreman if you&apos;re not sure.</p>

        {status === 'loading' && <p className="crewFine">Loading…</p>}

        {status === 'error' && (
          <>
            <p className="crewError">{error}</p>
            <button type="button" className="crewBtn ghost" onClick={load}>Try again</button>
          </>
        )}

        {status === 'ready' && rows.length === 0 && (
          <div className="crewEmpty">
            <strong>Nothing published yet</strong>
            <span>Your superintendent hasn&apos;t put today&apos;s JSA up. Check with him.</span>
            <button type="button" className="crewBtn ghost" onClick={load}>Check again</button>
          </div>
        )}

        {status === 'ready' && rows.map(r => (
          <button key={r.id} type="button" className="crewPick" onClick={() => { setPicked(r); setSigning(false); }}>
            <strong>{r.area_label}</strong>
            <span>
              {fmtDate(r.doc_date)}{r.job_site ? ` · ${r.job_site}` : ''}
              {!r.live && ' · closed'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
