import { useState } from 'react';
import { SIM_ON, runCode, newRunCode, MARKED_FIELD } from './simMode';
import { IS_DEMO } from '../shared/demoMode';
import seeds from './seeds.json';
import './sim.css';

/* ── Fill a whole document in one tap ────────────────────────────────────
   Lazy-loaded, so none of this -- panel or seed documents -- reaches a
   device that never turns the simulator on. See simMode.js for where it
   shows up and why everything it makes is marked.

   It only ever fills the form. Submitting, publishing and approving are
   done with the real buttons, by hand, because those are the things being
   tested. A simulator that pressed them too would be testing itself. */

const DRAFT_KEYS = {
  jsa: 'sdc.jsa.draft.v4',
  incident: 'sdc.incident.draft.v1',
  disciplinary: 'sdc.discipline.draft.v1',
  uncontrolledEvent: 'sdc.uncontrolled.draft.v1',
  medicalEvent: 'sdc.medical.draft.v1',
  separation: 'sdc.separation.draft.v1',
};

const LABELS = {
  jsa: 'JSA',
  incident: 'Incident Report',
  disciplinary: 'Disciplinary Notice',
  separation: 'Employee Separation',
  medicalEvent: 'Medical Event',
  uncontrolledEvent: 'Uncontrolled Event',
};

/* Who each one goes to when it is submitted, so the point of pressing the
   button is obvious before you press it. */
const GOES_TO = {
  jsa: 'your board',
  incident: 'a PM or an owner',
  disciplinary: 'HR',
  separation: 'HR',
  medicalEvent: 'a PM or an owner',
  uncontrolledEvent: 'a PM or an owner',
};

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function SimPanel() {
  const [code, setCode] = useState(runCode);
  const [note, setNote] = useState('');

  if (!SIM_ON) return null;

  function fill(docType) {
    const seed = seeds[docType];
    if (!seed) { setNote(`No seed for ${docType}.`); return; }

    const marked = { ...seed };
    /* Stamped into the field that is the document's headline on screen, so
       it reads as a simulation everywhere it turns up -- including HR's
       queue, where it would otherwise look like a real person being let
       go. */
    const field = MARKED_FIELD[docType];
    if (field) marked[field] = `${code} ${seed[field] || ''}`.trim();

    marked.id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    marked.status = 'draft';
    marked.lastSavedAt = '';
    marked.completedAt = '';
    /* Today's date, or the readiness check for a date in the past starts
       arguing with a document that is supposed to be ready to go. */
    if ('date' in marked) marked.date = todayISO();
    if ('noticeDate' in marked) marked.noticeDate = todayISO();

    try {
      localStorage.setItem(DRAFT_KEYS[docType], JSON.stringify(marked));
    } catch {
      setNote('This device would not store it. Storage may be full.');
      return;
    }

    /* Reloaded, not re-rendered. Every workflow holds its document in React
       state, loaded once when the app started -- so writing a draft to
       storage underneath a running app changes nothing you can see, and the
       first version of this button looked broken for exactly that reason.
       The reload keeps ?sim=1, so the panel is still there afterwards. */
    setNote(`${LABELS[docType]} filled in. Opening…`);
    window.location.reload();
  }

  function clearAll() {
    Object.values(DRAFT_KEYS).forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* per key, best effort */ }
    });
    /* Same reason as fill(): the app is holding these in memory, and one of
       them would autosave itself straight back if it were left mounted. */
    window.location.reload();
  }

  return (
    <div className="card simPanel">
      <div className="cardHeader">
        <h3>Simulator</h3>
        <p>
          Fills a whole document in one tap so you can test what happens next.
          Everything it makes is marked <strong>{code}</strong> so it can never be
          mistaken for real paperwork.
        </p>
      </div>
      <div className="cardBody">

        {IS_DEMO ? (
          <p className="simState simStateSafe">
            <strong>Testing site.</strong> Nothing here can reach the real board, the real
            archive, or anybody&rsquo;s queue — every send is refused before it leaves.
            Good for checking screens; it cannot prove the chain end to end.
          </p>
        ) : (
          <p className="simState simStateLive">
            <strong>This is the real app.</strong> If you sign in and submit one of these, it
            genuinely goes to {GOES_TO.separation === 'HR' ? 'HR or a PM' : 'a reviewer'} and
            shows up in their queue. That is the point — just know it is real.
          </p>
        )}

        <div className="simGrid">
          {Object.keys(LABELS).map(docType => (
            <button
              key={docType}
              type="button"
              className="btn secondary simFill"
              onClick={() => fill(docType)}
            >
              <strong>{LABELS[docType]}</strong>
              <span>Goes to {GOES_TO[docType]}</span>
            </button>
          ))}
        </div>

        {note && <p className="simNote">{note}</p>}

        <div className="simFooterRow">
          <button type="button" className="btn ghost sm" onClick={() => { setCode(newRunCode()); setNote('New run code. Anything you fill in from now on carries it.'); }}>
            New run code
          </button>
          <button type="button" className="btn ghost sm" onClick={clearAll}>
            Clear every draft on this device
          </button>
        </div>

        <p className="simFine">
          Filing to Records is permanent and has no delete, by design — so anything you
          approve and file during a simulation stays filed. It will read {code}, so it is
          obvious what it was, but it does not go away.
        </p>
      </div>
    </div>
  );
}
