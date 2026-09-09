import { useCallback, useEffect, useState } from 'react';
import SignaturePad from '../incident/SignaturePad';
import { fetchBoard, signPublication, readableRows } from './board';
import './crew.css';

/* ── The crew sign-in page ───────────────────────────────────────────────
   What a man sees after scanning the QR on the trailer door. No account,
   no login, no app -- this renders INSTEAD of the whole application when
   the address is #/sign/<board owner>, so nothing else has to load.

   The flow, in Fonzo's own words:
     show up in the morning -> scan QR -> ask foreman where you're working
     -> click that area/JSA -> sign your name.

   Built for a 50+ crew standing in a gravel lot at 6:30am on cracked
   phones in the sun: big targets, short words, high contrast, and the date
   and job stated plainly before anybody signs anything. A permanent QR
   can physically show the wrong meeting, unlike a per-meeting code, so
   confirming what you're about to sign is the price of never reprinting. */

const NAME_KEY = 'sdc.crew.name.v1';

function fmtDate(d) {
  if (!d) return '';
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d
    : parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function Line({ label, value }) {
  if (!String(value || '').trim()) return null;
  return <div className="crewLine"><span>{label}</span><strong>{value}</strong></div>;
}

/* What the JSA actually says, readable on a phone. */
function JsaContents({ jsa }) {
  if (!jsa) return null;
  const rows = readableRows(jsa);
  return (
    <div className="crewDoc">
      <div className="crewDocTitle">The JSA</div>

      <Line label="Job site" value={jsa.jobSite} />
      <Line label="Location" value={jsa.location} />
      <Line label="Job #" value={jsa.jobNumber} />
      <Line label="Supervisor" value={jsa.superintendentForeman} />
      <Line label="Overall task" value={jsa.overallWorkTask} />
      <Line label="Good from" value={[jsa.timeIssued, jsa.timeExpired].filter(Boolean).join(' to ')} />
      <Line label="Emergency" value={jsa.emergencyPhone} />
      <Line label="Nearest medical" value={jsa.nearestMedicalFacility} />
      <Line label="Muster point" value={jsa.musterPoint} />
      <Line label="Tailgate topic" value={jsa.tailgateTopic} />

      {rows.length > 0 && (
        <>
          <div className="crewDocTitle">Steps, hazards and controls</div>
          {rows.map((r, i) => (
            <div className="crewStep" key={i}>
              {r.step && <strong>{r.step}</strong>}
              {r.hazards && <p><span>Hazards</span>{r.hazards}</p>}
              {r.controls && <p><span>Controls</span>{r.controls}</p>}
            </div>
          ))}
        </>
      )}

      {String(jsa.acknowledgement || '').trim() && (
        <>
          <div className="crewDocTitle">What you are signing</div>
          <p className="crewAck">{jsa.acknowledgement}</p>
        </>
      )}
    </div>
  );
}

export default function CrewSignIn({ boardOwnerId }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
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
          <div className="crewCheck" aria-hidden="true">✓</div>
          <h1>You&apos;re signed in</h1>
          <p>{picked.area_label}</p>
          <p className="crewFine">{name.trim()} — {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          <button
            type="button"
            className="crewBtn ghost"
            onClick={() => { setDone(false); setPicked(null); setSignature(''); load(); }}
          >
            Sign another one
          </button>
        </div>
      </div>
    );
  }

  if (picked) {
    const expired = new Date() > new Date(picked.expires_at);
    return (
      <div className="crewWrap">
        <form className="crewCard" onSubmit={submit}>
          {/* Stated before anybody signs. See the header comment. */}
          <div className="crewConfirm">
            <span className="crewEyebrow">You are signing</span>
            <h1>{picked.area_label}</h1>
            <p>{fmtDate(picked.doc_date)}{picked.job_site ? ` · ${picked.job_site}` : ''}</p>
            {picked.version > 1 && (
              <p className="crewRevised">Revised — version {picked.version}</p>
            )}
            {expired && (
              <p className="crewLate">
                This one already expired. You can still sign, and it will be recorded as late.
              </p>
            )}
          </div>

          {/* The JSA itself, before he signs it. Added 2026-09-09 after a
              real tester pointed out he was being asked to acknowledge a
              document he could not read. The tailgate meeting still covers
              it out loud -- this is so the words are in his hand too.

              Laid out plainly and in full rather than behind a tab or an
              inner scroll: it is the thing he is signing, so scrolling past
              it is the honest gesture. */}
          <JsaContents jsa={picked.data} />

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
          <button type="button" className="crewBtn ghost" onClick={() => { setPicked(null); setError(''); }}>
            Wrong one — go back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="crewWrap">
      <div className="crewCard">
        <span className="crewEyebrow">Job Safety Analysis</span>
        <h1>Where are you working?</h1>
        <p className="crewLead">Ask your foreman which one you&apos;re on, then tap it.</p>

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
          <button key={r.id} type="button" className="crewPick" onClick={() => setPicked(r)}>
            <strong>{r.area_label}</strong>
            <span>{fmtDate(r.doc_date)}{r.job_site ? ` · ${r.job_site}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
