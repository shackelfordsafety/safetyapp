import { useCallback, useEffect, useRef, useState } from 'react';
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
  const signFormRef = useRef(null);

  /* Bring the form to him. Tapping Sign from the sticky bar can happen
     while he is anywhere in a five-screen document, and landing him back
     at the top of a wall of text having apparently done nothing is how the
     tap gets repeated and then abandoned. */
  useEffect(() => {
    if (!signing) return;
    const el = signFormRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [signing]);

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

          {picked.live && signing && (
            <form className="crewSignForm" ref={signFormRef} onSubmit={submit}>
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

              {/* Open and ready, no Save step. See the note on autoOpen in
                  SignaturePad: this screen is a man in a lot at 6:30am,
                  and every extra tap is a place to give up. */}
              <SignaturePad
                label="Your signature"
                value={signature}
                onChange={setSignature}
                autoOpen
                commitOnStroke
              />

              {error && <p className="crewError">{error}</p>}

              <button type="submit" className="crewBtn primary" disabled={busy || !name.trim()}>
                {busy ? 'Signing…' : 'Finish'}
              </button>
            </form>
          )}

          <button type="button" className="crewBtn ghost" onClick={backToList}>
            {signing ? 'Not yet — go back' : 'Back to the list'}
          </button>

        {/* ── "Where do I sign this thing?" ──
            Asked by several different men, independently, on the first real
            morning — every one of them at the same point, having opened the
            JSA and found no way to sign it.

            They were right. A real JSA runs about five phone screens, and
            the Sign button was at the bottom of all of it: genuinely
            off-screen, with nothing to say it existed. Reading the document
            first is the point of this page and stays that way — but the way
            OUT of the document has to be visible the entire time you are in
            it, not waiting at the end like a reward.

            It disappears once he is signing, because from there the form
            and its own Finish button are what he needs. */}
        {picked.live && !signing && (
          <div className="crewStickyBar">
            <button type="button" className="crewBtn primary" onClick={() => setSigning(true)}>
              Sign the JSA
            </button>
          </div>
        )}
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

        {/* A closed JSA is not signable any more (Fonzo, 2026-09-11: "no
            point in signing when the work is done"), so it does not open.
            It used to say Closed and then open the signing flow anyway,
            which is the same lie the Finish step was telling -- a label
            that says you cannot and a button that says you can.

            It still shows, deliberately. A man scanning the QR needs to
            see that the JSA he expected is there but finished, not an
            empty list that looks like the code is broken. */}
        {status === 'ready' && rows.map(r => (
          <button
            key={r.id}
            type="button"
            className={`crewPick crewPick--${r.status}`}
            disabled={r.status === 'closed'}
            aria-disabled={r.status === 'closed'}
            onClick={() => { if (r.status === 'closed') return; setPicked(r); setSigning(false); }}
          >
            <span className="crewPickTop">
              <strong>{r.area_label}</strong>
              <span className={`crewTag crewTag--${r.status}`}>
                {r.status === 'open' ? 'Open' : r.status === 'upcoming' ? 'Starts soon' : 'Closed'}
              </span>
            </span>
            <span>
              {fmtDate(r.doc_date)}{r.job_site ? ` · ${r.job_site}` : ''}
              {r.status === 'upcoming' && r.startsAt
                ? ` · starts ${r.startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : ''}
            </span>
            {r.status === 'closed' && (
              <span className="crewPickClosed">
                {r.expires_at
                  ? `Signing closed at ${new Date(r.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Ask your superintendent for today's JSA.`
                  : "Signing is closed. Ask your superintendent for today's JSA."}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
