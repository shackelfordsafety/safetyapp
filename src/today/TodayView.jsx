import { useCallback, useEffect, useState } from 'react';
import { fetchFiledToday } from '../archive/fileToArchive';
import { fetchMyBoard } from '../crew/board';
import './today.css';

/* ── Today ───────────────────────────────────────────────────────────────
   Everything from this morning in one place. Fonzo, 2026-09-09: "maybe we
   can make a today's tab and it has everything that's been done that day,
   jsa's, write ups, etc and it's easier to find it that way instead of
   going thru the archive."

   Replaces the old Drafts tab rather than sitting beside it. Same
   observation, his words: drafts "stay even tho we're done with them" --
   a list of things you have already finished, presented as unfinished
   work. Splitting the day into STILL OPEN and DONE TODAY answers that
   without deleting anything: a document that has been filed simply moves
   from the first list to the second.

   Signing in is not required to see what is open on this device. It is
   required to see what was filed or published, because that lives in the
   company archive -- so a signed-out device shows the top half and a
   quiet note rather than an error. */

const DOC_LABELS = {
  jsa: 'JSA',
  incident: 'Incident',
  disciplinary: 'Disciplinary',
  separation: 'Separation',
  medicalEvent: 'Medical',
  uncontrolledEvent: 'Uncontrolled',
};

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function TodayView({ entries = [], goDocs }) {
  const [filed, setFiled] = useState(undefined);   // undefined = loading, null = signed out
  const [published, setPublished] = useState(undefined);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const rows = await fetchFiledToday();
      setFiled(rows);
      if (rows === null) { setPublished(null); return; }
      try {
        const { rows: boardRows } = await fetchMyBoard();
        setPublished(boardRows);
      } catch {
        // A superintendent with no board is normal; never let it break the page.
        setPublished([]);
      }
    } catch (ex) {
      setError(ex?.message || 'Could not load today.');
      setFiled([]);
      setPublished([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stillOpen = entries.filter(e => e.savedDraft);
  const signedOut = filed === null;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">Today</div>
        <h2>{today}</h2>
        <p>What you started and what you finished. Older paperwork lives in the Archive.</p>
      </div>

      <div className="todaySection">
        <div className="todayHead">
          <span className="todayLabel">Still open</span>
          <span className="todayCount">{stillOpen.length}</span>
        </div>
        {stillOpen.length ? (
          <div className="listStack">
            {stillOpen.map(e => (
              <div className="listItem" key={e.id}>
                <div className="itemInfo">
                  <div className="itemInfoTitleRow">
                    <strong>{e.draftTitle}</strong>
                    <span className={`badge ${e.savedDraft.status === 'ready' || e.savedDraft.status === 'completed' ? 'ready' : 'draft'}`}>
                      {e.savedDraft.status === 'completed' ? 'Completed' : e.savedDraft.status === 'ready' ? 'Ready' : 'Draft'}
                    </span>
                  </div>
                  <p>{e.metaLine}</p>
                </div>
                <div className="itemActions">
                  <button className="btn secondary sm" onClick={e.onOpen}>Open</button>
                  <button className="btn ghost sm" onClick={e.onDelete}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <p>Nothing open on this device.</p>
            <button className="btn primary sm" onClick={goDocs}>Start a document</button>
          </div>
        )}
      </div>

      <div className="todaySection">
        <div className="todayHead">
          <span className="todayLabel">Out for signing</span>
          {Array.isArray(published) && <span className="todayCount">{published.length}</span>}
        </div>
        {signedOut ? (
          <p className="todayNote">Sign in up top to see what you put on your board today.</p>
        ) : published === undefined ? (
          <p className="todayNote">Loading…</p>
        ) : published.length === 0 ? (
          <p className="todayNote">Nothing published to your board today.</p>
        ) : (
          <div className="listStack">
            {published.map(r => (
              <div className="listItem" key={r.id}>
                <div className="itemInfo">
                  <div className="itemInfoTitleRow">
                    <strong>{r.area_label}</strong>
                    <span className={`badge ${r.live ? 'draft' : 'ready'}`}>{r.live ? 'Live' : 'Closed'}</span>
                  </div>
                  <p>Published {fmtTime(r.published_at)} · {r.signed} signed</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="todaySection">
        <div className="todayHead">
          <span className="todayLabel">Filed today</span>
          {Array.isArray(filed) && <span className="todayCount">{filed.length}</span>}
        </div>
        {error && <p className="todayNote">{error}</p>}
        {signedOut ? (
          <p className="todayNote">Sign in up top to see what was filed to the archive.</p>
        ) : filed === undefined ? (
          <p className="todayNote">Loading…</p>
        ) : filed.length === 0 ? (
          <p className="todayNote">Nothing filed yet today.</p>
        ) : (
          <div className="listStack">
            {filed.map(r => (
              <div className="listItem" key={r.id}>
                <div className="itemInfo">
                  <div className="itemInfoTitleRow">
                    <strong>{r.employee_name || r.job_site || DOC_LABELS[r.doc_type] || r.doc_type}</strong>
                    <span className="badge ready">{DOC_LABELS[r.doc_type] || r.doc_type}</span>
                  </div>
                  <p>Filed {fmtTime(r.submitted_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
