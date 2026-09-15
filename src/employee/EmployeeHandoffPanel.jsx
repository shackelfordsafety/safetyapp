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

export default function EmployeeHandoffPanel({ docType, model, employeeName, needs, respondedAt, onReceived }) {
  const [handoff, setHandoff] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [received, setReceived] = useState(null);
  /* Whether the manager has deliberately asked to go round again. Starts
     false every time the screen is opened, so the button is never one
     stray tap away. */
  const [redoing, setRedoing] = useState(false);
  const timer = useRef(null);

  const stop = useCallback(() => { clearInterval(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const mod = await loadModule(() => import('./handoffRequests'));
      const made = await mod.createHandoff({ docType, model, employeeName, needs });
      setHandoff(made);

      /* Polled rather than pushed. They are standing in front of you and this
         takes a minute; a realtime subscription would be more machinery for
         a wait that somebody is watching anyway. Every four seconds is
         often enough to feel immediate and rare enough to be free. */
      timer.current = setInterval(async () => {
        try {
          const answer = await mod.checkHandoff(made.token);
          if (answer && !answer.waiting) {
            stop();
            setReceived(answer);
            onReceived?.(answer);
          }
        } catch { /* a dropped poll is not worth showing; the next one retries */ }
      }, 4000);
    } catch (ex) {
      setError(ex?.message || 'Could not create the code.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    stop();
    const token = handoff?.token;
    setHandoff(null);
    if (!token) return;
    try {
      const mod = await loadModule(() => import('./handoffRequests'));
      await mod.cancelHandoff(token);
    } catch { /* it expires on its own within two hours regardless */ }
  }

  if (received) {
    return (
      <div className="card empPanel empPanelDone">
        <div className="cardHeader"><strong>The employee sent their part back</strong></div>
        <div className="cardBody">
          <p className="empMuted">
            {received.statement
              ? 'Their statement and signature are on the notice now.'
              : 'Their signature is on the notice now. They chose not to give a statement.'}
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
            {employeeName || 'The employee'} sent it back {said}. What they wrote and
            signed is on the notice below and cannot be changed here.
          </p>
          <button type="button" className="btn ghost sm" onClick={() => setRedoing(true)}>
            Ask them again
          </button>
          <p className="empMuted">
            Only if it genuinely has to be redone. A new code replaces what they sent
            the first time on this notice.
          </p>
        </div>
      </div>
    );
  }

  if (!handoff) {
    return (
      <div className="card empPanel">
        <div className="cardHeader">
          <strong>Let the employee do their part on their own phone</strong>
          <p>
            They scan one code and get the whole notice to read, a box for their
            statement, and somewhere to sign. Nothing leaves your hands.
          </p>
        </div>
        <div className="cardBody">
          {error && <p className="empError">{error}</p>}
          <button type="button" className="btn primary" onClick={start} disabled={busy}>
            {busy ? 'Making the code…' : 'Show the code'}
          </button>
          {/* Points back at the fork above rather than "the pad below" --
              there is no longer a pad below, because choosing this path is
              what put this panel here. Saying otherwise sent people looking
              for a control that is not on screen. */}
          <p className="empMuted">
            If their phone is dead or there is no signal, switch to
            <strong> On this device</strong> above and nothing is lost.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card empPanel">
      <div className="cardHeader">
        <strong>Hand over the screen &mdash; or read out the link</strong>
        <p>Waiting for them to send it back. Leave this open.</p>
      </div>
      <div className="cardBody empQrBody">
        <QrImage url={handoff.url} />
        {/* The link in plain text underneath, because a camera that will not
            focus on a QR code in the sun is not a rare event on a job site.
            Selectable so it can be texted to them. */}
        <p className="empLink">{handoff.url}</p>
        <p className="empMuted">The code stops working in two hours, or the moment they send it.</p>
        <button type="button" className="btn ghost sm" onClick={cancel}>Cancel this code</button>
      </div>
    </div>
  );
}
