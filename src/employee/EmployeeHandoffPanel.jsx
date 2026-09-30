import { useCallback, useEffect, useRef, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './employee.css';

/* ── "Here is your part" ─────────────────────────────────────────────────
   The step between management finishing their side and the employee doing
   theirs. Fonzo, 2026-09-15: "once they finish their part... it gets to a step
   in the workflow where it's like, okay, this is what the employee needs to
   do, and it scans a QR code, and it gives them everything he needs to do."

   Quoted as he said it. The SCREEN, though, says "they" throughout --
   Fonzo, 2026-09-15: "not everybody's he... I don't want a girl
   complaining, like, why does it say he blah blah blah. We gotta just be
   professional and neutral throughout the entire thing."

   One code for everything they owe -- read the notice, give a statement,
   sign -- on their own phone, because handing your iPad to somebody you have
   just written up is how iPads get thrown.

   It does not block anything. Everything here is optional: if their phone is
   dead, or there is no signal in the trailer, the pads on this device still
   work and the notice can still be finished. A handoff that can trap a
   document half-done would be worse than no handoff at all. */

/* The words on this panel, per kind of request. The notice wording is the
   original; the rest say what the other person is actually being asked. */
const PANEL_COPY = {
  notice: {
    intro: 'They scan it, read the notice, write their statement, and sign on their phone.',
    doneWithStatement: 'Their statement and signature are on the notice now.',
    doneSignatureOnly: 'Their signature is on the notice now. They chose not to give a statement.',
    already: 'What they wrote and signed is on the notice below and cannot be changed here.',
    redo: 'Only if it genuinely has to be redone. A new code replaces what they sent the first time on this notice.',
  },
  medicalEvent: {
    intro: 'They scan it, read the form, and sign on their phone.',
    doneWithStatement: 'Their signature is on the form now.',
    doneSignatureOnly: 'Their signature is on the form now.',
    already: 'Their signature is on the form below and cannot be changed here.',
    redo: 'Only if it genuinely has to be redone. A new code replaces the signature they sent the first time.',
  },
  incidentWitness: {
    intro: 'They scan it, write what they saw, and sign. They only see the incident date and place.',
    doneWithStatement: 'Their statement and signature are in this witness slot now.',
    doneSignatureOnly: 'Their signature is in this witness slot now.',
    already: 'What they wrote and signed is below and cannot be changed here.',
    redo: 'Only if it genuinely has to be redone. A new code replaces what they sent the first time.',
  },
};

function QrImage({ url }) {
  const [png, setPng] = useState('');
  useEffect(() => {
    let alive = true;
    if (!url) return undefined;
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 720,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#171719', light: '#FFFFFF' },
        });
        if (alive) setPng(dataUrl);
      } catch { /* the link below still works */ }
    })();
    return () => { alive = false; };
  }, [url]);
  if (!png) return <div className="empQrPlaceholder">Drawing the code…</div>;
  return <img className="empQr" src={png} alt="Scan this with the employee's phone" />;
}

/* Same address handoffRequests.employeeUrlFor builds. Repeated here so a
   code saved on the document can be drawn again straight away on reopen,
   even with no signal and before the cloud module has loaded. */
function urlForToken(token) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/me/${token}`;
}

/* A code lives two hours (the database enforces it -- see the
   new_handoff_is_blank trigger). Kept on the saved code only as a backstop
   for when the server cannot say (see watch() below). */
const CODE_LIFETIME_MS = 2 * 60 * 60 * 1000;

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* PENDING CODES ARE SAVED ON THE DOCUMENT (audit 2026-09-30, C3).
   `pending` is { token, createdAt, expiresAt } -- employeeHandoff on the
   HR documents, handoff on an incident witness -- and `onPendingChange`
   writes it back through the workflow's own upd(), so autosave keeps it.

   It used to live only in this component. Tap Next, Home, or reload while
   they were still signing, and the panel forgot the code: their phone said
   "Sent", the answer never came back into the document, and the manager
   was offered a brand-new code and had to make them do it all again. Now
   the code outlives the screen, and whichever copy of this panel is open
   next picks the wait back up where it left off. */
export default function EmployeeHandoffPanel({
  docType, model, employeeName, needs, respondedAt, onReceived, pending, onPendingChange,
}) {
  const pendingToken = pending?.token || '';
  const [handoff, setHandoff] = useState(() => (
    pendingToken ? { token: pendingToken, url: urlForToken(pendingToken), expiresAt: pending?.expiresAt || '' } : null
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [received, setReceived] = useState(null);
  const [expired, setExpired] = useState(false);
  /* Whether the manager has deliberately asked to go round again. Starts
     false every time the screen is opened, so the button is never one
     stray tap away. */
  const [redoing, setRedoing] = useState(false);
  const timer = useRef(null);
  /* Which code is being watched, and a counter bumped by every stop(): an
     answer still in flight from a poll that has since been stopped (screen
     closed, code cancelled) is dropped, not applied twice or to nothing. */
  const watching = useRef('');
  const generation = useRef(0);
  const mounted = useRef(true);
  /* The newest callbacks, not the ones from the render the poll started
     in -- the answer can land minutes later, after the document changed. */
  const onReceivedRef = useRef(onReceived);
  const onPendingRef = useRef(onPendingChange);
  onReceivedRef.current = onReceived;
  onPendingRef.current = onPendingChange;
  const copy = PANEL_COPY[docType] || PANEL_COPY.notice;

  const stop = useCallback(() => {
    clearInterval(timer.current);
    timer.current = null;
    watching.current = '';
    generation.current += 1;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  /* Polled rather than pushed. They are standing in front of you and this
     takes a minute; a realtime subscription would be more machinery for
     a wait that somebody is watching anyway. Every four seconds is often
     enough to feel immediate and rare enough to be free.

     It stops for good on an answer, and on an expired code -- it used to
     keep asking every four seconds forever after the two hours were up.
     A null (the server cannot see the code: cancelled, or a different
     account signed in) is not treated as expiry until the saved expiry time
     has passed too, so a sign-in hiccup cannot throw away a live code. */
  function watch(mod, token, expiresAt) {
    stop();
    const gen = generation.current;
    watching.current = token;
    const tick = async () => {
      let answer;
      try {
        answer = await mod.checkHandoff(token);
      } catch { return; /* a dropped poll is not worth showing; the next one retries */ }
      if (gen !== generation.current) return;
      if (answer && !answer.waiting) {
        stop();
        setHandoff(null);
        setReceived(answer);
        onPendingRef.current?.(null);
        onReceivedRef.current?.(answer);
        return;
      }
      const pastSaved = expiresAt && new Date(expiresAt).getTime() <= Date.now();
      if ((answer && answer.expired) || (!answer && pastSaved)) {
        stop();
        setHandoff(null);
        setExpired(true);
        onPendingRef.current?.(null);
      }
    };
    timer.current = setInterval(tick, 4000);
    return tick;
  }

  /* Reopened with a code still out -- pick the wait back up. Checked once
     straight away, because the answer has usually been sitting there the
     whole time the manager was on another step. */
  useEffect(() => {
    if (!pendingToken || watching.current === pendingToken) return undefined;
    let alive = true;
    setHandoff({ token: pendingToken, url: urlForToken(pendingToken), expiresAt: pending?.expiresAt || '' });
    setExpired(false);
    (async () => {
      try {
        const mod = await loadModule(() => import('./handoffRequests'));
        if (!alive || !mounted.current) return;
        watch(mod, pendingToken, pending?.expiresAt || '')();
      } catch { /* offline and the module is not cached: the code still shows, and reopening retries */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToken]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const mod = await loadModule(() => import('./handoffRequests'));
      /* The saved code is bookkeeping, not part of what they read. */
      const { employeeHandoff: _saved, ...snapshot } = model || {};
      const made = await mod.createHandoff({ docType, model: snapshot, employeeName, needs });
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString();
      /* Saved first, so a code made while the manager was already tapping
         away is not lost with the screen. */
      if (mounted.current) {
        setExpired(false);
        setHandoff({ ...made, expiresAt });
        watch(mod, made.token, expiresAt);
      }
      onPendingRef.current?.({ token: made.token, createdAt, expiresAt });
    } catch (ex) {
      if (mounted.current) setError(ex?.message || 'Could not create the code.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function cancel() {
    stop();
    const token = handoff?.token;
    setHandoff(null);
    onPendingRef.current?.(null);
    if (!token) return;
    try {
      const mod = await loadModule(() => import('./handoffRequests'));
      await mod.cancelHandoff(token);
    } catch { /* it expires on its own within two hours regardless */ }
  }

  if (received) {
    return (
      <div className="card empPanel empPanelDone">
        <div className="cardHeader">
          <strong>{docType === 'incidentWitness' ? 'The witness sent their statement back' : 'The employee sent their part back'}</strong>
        </div>
        <div className="cardBody">
          <p className="empMuted">
            {received.statement ? copy.doneWithStatement : copy.doneSignatureOnly}
          </p>
        </div>
      </div>
    );
  }

  /* They have already done their part -- on this screen, or on a previous
     sitting that was saved and reopened. Do NOT quietly offer a fresh code
     here: sending one and having them sign again replaces what they sent the
     first time, and a signature that the employer can re-take on demand is
     not much better than one the employer can edit. So it says what
     happened, and going round again is a deliberate second tap. */
  if (!handoff && !redoing && respondedAt) {
    const when = new Date(respondedAt);
    const said = Number.isNaN(when.getTime())
      ? 'on their own phone'
      : `on their own phone on ${when.toLocaleString(undefined, {
        month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      })}`;
    return (
      <div className="card empPanel empPanelDone">
        <div className="cardHeader"><strong>They have already done their part</strong></div>
        <div className="cardBody">
          <p className="empMuted">
            {employeeName || 'They'} sent it back {said}. {copy.already}
          </p>
          <button type="button" className="btn ghost sm" onClick={() => setRedoing(true)}>
            Ask them again
          </button>
          <p className="empMuted">{copy.redo}</p>
        </div>
      </div>
    );
  }

  if (!handoff) {
    return (
      <div className="card empPanel">
        <div className="cardHeader">
          <p>{copy.intro}</p>
        </div>
        <div className="cardBody">
          {/* A code that ran out is said out loud, not quietly swapped for
              the fresh-start screen as if nothing had been sent. */}
          {expired && !error && (
            <p className="empExpired" role="status">This code expired before they sent it back — make a new one.</p>
          )}
          {error && <p className="empError">{error}</p>}
          <button type="button" className="btn primary" onClick={start} disabled={busy}>
            {busy ? 'Making the code…' : (expired ? 'Make a new code' : 'Show the QR code')}
          </button>
          {/* Points back at the fork above -- choosing this path is what put
              this panel here. */}
          <p className="helperText">Dead phone or no signal? Pick <strong>On this device</strong> instead.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card empPanel">
      <div className="cardHeader">
        <strong>Have them scan this</strong>
        <p>It fills in by itself when they send it back. You can leave this step and come back — it keeps waiting.</p>
      </div>
      <div className="cardBody empQrBody">
        <QrImage url={handoff.url} />
        {/* The link in plain text underneath, because a camera that will not
            focus on a QR code in the sun is not a rare event on a job site.
            Selectable so it can be texted to them. */}
        <p className="empLink">{handoff.url}</p>
        <p className="empMuted">
          {fmtTime(handoff.expiresAt) ? `Works until ${fmtTime(handoff.expiresAt)}, one time only.` : 'Works for 2 hours, one time only.'}
        </p>
        <button type="button" className="btn ghost sm" onClick={cancel}>Cancel this code</button>
      </div>
    </div>
  );
}
