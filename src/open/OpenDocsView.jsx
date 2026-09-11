import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './opendocs.css';

/* ── Open ────────────────────────────────────────────────────────────────
   Everything the company has started and not finished. The half that never
   existed: until now a document was on one man's iPad where nobody could
   see it, or in the archive permanently.

   Built as a worklist, not an inbox. The first thing on the screen is what
   is waiting on YOU -- a PM opening this at 7am should see the two reports
   he has to sign off before he sees anything else. Everything else is
   below that, in one list, because a tab is a decision and a document
   behind the wrong tab is a document nobody finishes.

   Lazily loaded like everything that talks to the cloud, so a
   superintendent building a JSA in a dead zone never downloads it. */

const DOC_LABELS = {
  jsa: 'JSA',
  incident: 'Incident Report',
  disciplinary: 'Disciplinary Notice',
  separation: 'Employee Separation',
  medicalEvent: 'Medical Event',
  uncontrolledEvent: 'Uncontrolled Event',
};

/* Who signs this kind of document off. Mirrors can_file_doc_type() in the
   database -- the database is what actually enforces it; this only decides
   what to put on screen. */
const APPROVERS = {
  incident: ['pm', 'hr', 'owner'],
  medicalEvent: ['pm', 'hr', 'owner'],
  uncontrolledEvent: ['pm', 'hr', 'owner'],
  disciplinary: ['hr', 'owner'],
  separation: ['hr', 'owner'],
  jsa: [],
};

function canSignOff(docType, role) {
  return (APPROVERS[docType] || []).includes(role);
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Row({ row, me, onOpen, onHandOver, onSignOff, onSendBack, onAbandon, busy }) {
  const waiting = row.state === 'submitted';
  const mine = row.created_by === me?.id;
  const heldByMe = row.assigned_to === me?.id;
  const iCanSign = waiting && canSignOff(row.doc_type, me?.role);

  return (
    <div className={`odRow${waiting ? ' odRow--waiting' : ''}`}>
      <button type="button" className="odRowMain" onClick={() => onOpen(row)}>
        <span className="odRowTop">
          <span className="odType">{DOC_LABELS[row.doc_type] || row.doc_type}</span>
          {waiting && <span className="odTag odTag--waiting">Waiting for sign-off</span>}
          {heldByMe && !waiting && <span className="odTag odTag--yours">Yours to finish</span>}
        </span>
        <strong className="odTitle">
          {row.employee_name || row.job_site || 'Untitled'}
        </strong>
        <span className="odMeta">
          Started by {row.createdByName || 'someone'}
          {row.assignedToName && !heldByMe ? ` · with ${row.assignedToName}` : ''}
          {row.updated_at ? ` · touched ${fmtWhen(row.updated_at)}` : ''}
        </span>
        {row.waiting_on && (
          <span className="odWaitingOn">Waiting on: {row.waiting_on}</span>
        )}
        {row.returned_note && (
          <span className="odReturned">
            Sent back by {row.returnedByName || 'the approver'}: {row.returned_note}
          </span>
        )}
      </button>

      <div className="odRowActions">
        {iCanSign && (
          <>
            <button type="button" className="btn primary sm" onClick={() => onSignOff(row)} disabled={busy}>
              Sign off &amp; file
            </button>
            <button type="button" className="btn ghost sm" onClick={() => onSendBack(row)} disabled={busy}>
              Send back
            </button>
          </>
        )}
        {!waiting && (
          <button type="button" className="btn secondary sm" onClick={() => onHandOver(row)} disabled={busy}>
            Hand over
          </button>
        )}
        {mine && (
          <button type="button" className="odDrop" onClick={() => onAbandon(row)} disabled={busy}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/* `embedded` drops the page wrapper and its own heading so this can be a
   SECTION of My Work rather than a sixth place to go. Fonzo asked for
   fewer destinations, not more, and "documents waiting on me" is not a
   different errand from "my work" -- it is the first thing on it. */
export default function OpenDocsView({ onPickUp, embedded = false }) {
  const [state, setState] = useState('loading'); // loading | ready | signedout | error
  const [rows, setRows] = useState([]);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState(null);
  const [sendingBack, setSendingBack] = useState(null);
  const [people, setPeople] = useState([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const mod = await loadModule(() => import('./openDocs'));
      if (!mod) return;
      const [list, who] = await Promise.all([mod.listOpenDocuments(), mod.whoAmI()]);
      setRows(list);
      setMe(who);
      setState('ready');
    } catch (ex) {
      if (ex?.name === 'NotSignedInError') { setState('signedout'); return; }
      setError(ex?.message || 'Could not load open documents.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Split once, used twice. "Waiting on me" is the whole reason a PM opens
     this screen, so it is not something he should have to find. */
  const { forMe, everythingElse } = useMemo(() => {
    const a = [];
    const b = [];
    rows.forEach((r) => {
      const needsMe = (r.state === 'submitted' && canSignOff(r.doc_type, me?.role))
        || (r.state === 'open' && r.assigned_to === me?.id);
      (needsMe ? a : b).push(r);
    });
    return { forMe: a, everythingElse: b };
  }, [rows, me]);

  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (ex) {
      setError(ex?.message || 'That did not work. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  /* Opening a shared document puts it in the workflow's own draft slot,
     which is the slot whatever the man is already working on lives in. So
     it asks first, and only when there is actually something to lose --
     asking every time trains people to tap through it.

     The confirm is deliberately plain rather than the app's nicer dialog:
     this component renders inside My Work, and a second modal system on a
     screen that already has two would be worse than a blunt one. */
  async function pickUp(row) {
    setBusy(true);
    setError('');
    try {
      const mod = await loadModule(() => import('./openDocs'));
      const { draftKeyFor } = await loadModule(() => import('./pickUp'));
      const key = draftKeyFor(row.doc_type);
      const existing = key ? localStorage.getItem(key) : null;
      if (existing) {
        const ok = window.confirm(
          'Opening this will replace what you have started on this device for that kind of document.\n\n'
          + 'Anything you have not sent up will be lost. Open it anyway?'
        );
        if (!ok) { setBusy(false); return; }
      }
      await mod.pickUpOpenDocument(row.id);
      onPickUp?.(row);
    } catch (ex) {
      setError(ex?.message || 'Could not open it. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function openHandOver(row) {
    setHanding({ row, to: row.assigned_to || '', note: row.waiting_on || '' });
    if (!people.length) {
      try {
        const mod = await loadModule(() => import('./openDocs'));
        setPeople(await mod.peopleToHandTo());
      } catch { /* the picker just stays empty; the note still works */ }
    }
  }

  /* Embedded inside My Work, a signed-out state is noise -- that screen
     already says to sign in, and repeating it twice on one page reads like
     something is broken. */
  if (state === 'signedout') {
    if (embedded) return null;
    return (
      <div className="page">
        <div className="odEmpty">
          <strong>Sign in to see open documents</strong>
          <span>Use the button at the top right. Building a document never needs a login — this does.</span>
        </div>
      </div>
    );
  }

  /* Nothing waiting and nothing shared is the normal state for most
     people most days. As a section of a bigger screen it should simply not
     be there, rather than taking up room to say so. */
  if (embedded && state === 'ready' && rows.length === 0) return null;


  return (
    <div className={embedded ? 'odEmbedded' : 'page'}>
      {!embedded && (
        <div className="odHead">
          <div>
            <h2>Open</h2>
            <p>Started and not finished. Anything waiting on you is at the top.</p>
          </div>
          <button type="button" className="btn ghost sm" onClick={load} disabled={busy}>Refresh</button>
        </div>
      )}

      {error && <div className="archiveError">{error}</div>}
      {state === 'loading' && <p className="helperText">Loading…</p>}

      {state === 'ready' && rows.length === 0 && (
        <div className="odEmpty">
          <strong>Nothing open</strong>
          <span>
            Everything started has been finished and filed. A document shows up here when somebody
            shares it so others can help, or sends it for sign-off.
          </span>
        </div>
      )}

      {/* "Waiting on you" is a real section with a real edge, not the thin
          line of text it was. Fonzo, 2026-09-11: "my work looks like shit.
          When something's waiting at the top, it's really not known... you
          don't know if you have to click on it or not."

          So: its own card, a count that reads as a count, and a line that
          says outright what to do with it. */}
      {forMe.length > 0 && (
        <section className="odBlock odBlock--mine">
          <header className="odBlockHead">
            <span className="odBlockCount">{forMe.length}</span>
            <div className="odBlockTitle">
              <strong>Waiting on you</strong>
              <span>
                {forMe.length === 1 ? 'One document needs' : `${forMe.length} documents need`} something
                from you. Tap one to open and read it.
              </span>
            </div>
          </header>
          {forMe.map(r => (
            <Row
              key={r.id} row={r} me={me} busy={busy}
              onOpen={pickUp}
              onHandOver={openHandOver}
              onSignOff={row => act(async () => {
                const mod = await loadModule(() => import('./openDocs'));
                await mod.signOffAndFile(row.id);
              })}
              onSendBack={row => setSendingBack({ row, note: '' })}
              onAbandon={row => act(async () => {
                const mod = await loadModule(() => import('./openDocs'));
                await mod.abandon(row.id);
              })}
            />
          ))}
        </section>
      )}

      {everythingElse.length > 0 && (
        <section className="odBlock">
          <header className="odBlockHead">
            <span className="odBlockCount odBlockCount--quiet">{everythingElse.length}</span>
            <div className="odBlockTitle">
              <strong>{forMe.length > 0 ? 'Everything else going on' : 'Open documents'}</strong>
              <span>Started by somebody and not finished. Nothing here is waiting on you.</span>
            </div>
          </header>
          {everythingElse.map(r => (
            <Row
              key={r.id} row={r} me={me} busy={busy}
              onOpen={pickUp}
              onHandOver={openHandOver}
              onSignOff={() => {}}
              onSendBack={() => {}}
              onAbandon={row => act(async () => {
                const mod = await loadModule(() => import('./openDocs'));
                await mod.abandon(row.id);
              })}
            />
          ))}
        </section>
      )}

      {handing && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setHanding(null); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Hand it over" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: 0 }}>Hand it over</h3>
            <p className="helperText">
              They&apos;ll see it under &ldquo;waiting on you&rdquo;. Say what you need from them so
              they aren&apos;t guessing.
            </p>
            <label className="field">
              <span>Who</span>
              <select value={handing.to} onChange={e => setHanding(h => ({ ...h, to: e.target.value }))}>
                <option value="">Nobody in particular</option>
                {people.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>What it&apos;s waiting on</span>
              <input
                value={handing.note}
                onChange={e => setHanding(h => ({ ...h, note: e.target.value }))}
                placeholder="Chris's witness statement"
                maxLength={140}
              />
            </label>
            <div className="dialogActions">
              <button type="button" className="btn ghost" onClick={() => setHanding(null)}>Cancel</button>
              <button
                type="button" className="btn primary" disabled={busy}
                onClick={() => {
                  const { row, to, note } = handing;
                  setHanding(null);
                  act(async () => {
                    const mod = await loadModule(() => import('./openDocs'));
                    await mod.handOver({ id: row.id, assignedTo: to || null, waitingOn: note });
                  });
                }}
              >
                Hand it over
              </button>
            </div>
          </div>
        </div>
      )}

      {sendingBack && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setSendingBack(null); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Send it back" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: 0 }}>Send it back</h3>
            <p className="helperText">
              It goes back to whoever had it, with your reason on it. Say what needs fixing — a
              document returned with no explanation just comes back the same.
            </p>
            <label className="field">
              <span>What needs doing</span>
              <input
                value={sendingBack.note}
                onChange={e => setSendingBack(s => ({ ...s, note: e.target.value }))}
                placeholder="Need the witness statement before I can sign this"
                maxLength={200}
              />
            </label>
            <div className="dialogActions">
              <button type="button" className="btn ghost" onClick={() => setSendingBack(null)}>Cancel</button>
              <button
                type="button" className="btn primary" disabled={busy || !sendingBack.note.trim()}
                onClick={() => {
                  const { row, note } = sendingBack;
                  setSendingBack(null);
                  act(async () => {
                    const mod = await loadModule(() => import('./openDocs'));
                    await mod.sendBack({ id: row.id, note });
                  });
                }}
              >
                Send it back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
