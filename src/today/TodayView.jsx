import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { fetchFiledToday, signedUrlFor } from '../archive/fileToArchive';
import { fetchMyBoard } from '../crew/board';
import JsaContents from '../crew/JsaContents';
import './today.css';
import HelpButton from '../shared/HelpButton';

/* Lazy, like everything that talks to the cloud, so a superintendent
   building a JSA in a dead zone never downloads it. */
const OpenDocsView = lazy(() => import('../open/OpenDocsView'));
const ChangeNotices = lazy(() => import('../open/ChangeNotices'));

/* ── Today ───────────────────────────────────────────────────────────────
   Everything from this morning in one place. Fonzo, 2026-09-09: "maybe we
   can make a today's tab and it has everything that's been done that day,
   jsa's, write ups, etc and it's easier to find it that way instead of
   going thru the archive."

   Replaces the old Drafts tab rather than sitting beside it. Same
   observation, his words: drafts "stay even tho we're done with them" --
   a list of things you have already finished, presented as unfinished
   work. Splitting the day answers that without deleting anything: a
   document that gets finished simply moves down the page.

   Three sections, and the split matters:
     Still open      on this device, unfinished
     Out for signing LIVE board entries only -- an expired one is not out
                     for signing any more, so it moves down (Fonzo: "a
                     closed one that expired is still under out for signing
                     as well, maybe the closed ones should go under filed")
     Done today      filed to the archive, plus board entries that closed

   Every row here opens something. The first version listed the day without
   letting you touch any of it, which Fonzo rightly said did not beat
   digging through the Archive: "you can't tap on anything and bring up the
   final PDF to download". A filed document opens its PDF; a board entry
   opens the JSA the crew signed.

   Signing in is not required for the top section -- that is local, and a
   device that only builds documents should still show its own work. */

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

function Section({ label, count, children }) {
  return (
    <div className="todaySection">
      <div className="todayHead">
        <span className="todayLabel">{label}</span>
        {typeof count === 'number' && <span className="todayCount">{count}</span>}
      </div>
      {children}
    </div>
  );
}

export default function TodayView({ entries = [], goDocs, onPickedUp }) {
  const [filed, setFiled] = useState(undefined);   // undefined = loading, null = signed out
  const [board, setBoard] = useState(undefined);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [opening, setOpening] = useState('');
  const [openError, setOpenError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const rows = await fetchFiledToday();
      setFiled(rows);
      if (rows === null) { setBoard(null); return; }
      try {
        const { rows: boardRows } = await fetchMyBoard();
        setBoard(boardRows);
      } catch {
        // A superintendent with no board is normal; never break the page.
        setBoard([]);
      }
    } catch (ex) {
      setError(ex?.message || 'Could not load today.');
      setFiled([]);
      setBoard([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Opens the real document. A row without a stored PDF -- an old
     publication, or one where generation failed -- falls back to the
     readable view rather than doing nothing. */
  async function openFiled(row, fallbackToPreview) {
    if (!row.pdf_path) {
      if (fallbackToPreview) { setPreview(row); return; }
      setOpenError('That one was filed without a PDF.');
      return;
    }
    setOpening(row.id);
    setOpenError('');
    try {
      const url = await signedUrlFor(row.pdf_path);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (ex) {
      setOpenError(ex?.message || 'Could not open it. Check your connection.');
    } finally {
      setOpening('');
    }
  }

  const stillOpen = entries.filter(e => e.savedDraft);
  const signedOut = filed === null;
  const live = Array.isArray(board) ? board.filter(r => r.live) : [];
  const closed = Array.isArray(board) ? board.filter(r => !r.live) : [];
  const doneCount = (Array.isArray(filed) ? filed.length : 0) + closed.length;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">My Work</div>
        <div className="titleWithHelp">
          <h2>{today}</h2>
          <HelpButton title="My Work">
            <p>Your own work — what you started today and what you finished.</p>
            <p><strong>The three lists:</strong></p>
            <ul>
              <li><strong>Still open</strong> — started and not done. Tap one to pick up where you left off.</li>
              <li><strong>Out for signing</strong> — on your board, waiting on the crew.</li>
              <li><strong>Done today</strong> — finished and filed.</li>
            </ul>
            <p>
              Every row opens something. Anything from before today is in
              <strong> Records</strong>.
            </p>
          </HelpButton>
        </div>
        <p>What you started and what you finished. Older paperwork lives in Records.</p>
      </div>

      {/* Above everything, including the review queue: if an approver
          reworded your report, that is the one thing on this screen you
          did not already know. */}
      <Suspense fallback={null}>
        <ChangeNotices />
      </Suspense>

      {/* Documents the company has going, and anything waiting on YOU to
          sign off, above your own local work. A PM opening this at 7am
          should see the two reports he has to approve before he sees his
          own drafts. Renders nothing at all when there is nothing there,
          which is most people most days. */}
      <Suspense fallback={null}>
        <OpenDocsView embedded onPickUp={row => onPickedUp?.(row.doc_type)} />
      </Suspense>

      <Section label="Still open" count={stillOpen.length}>
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
      </Section>

      <Section label="Out for signing" count={signedOut ? undefined : live.length}>
        {signedOut ? (
          <p className="todayNote">Sign in up top to see what you put on your board today.</p>
        ) : board === undefined ? (
          <p className="todayNote">Loading…</p>
        ) : live.length === 0 ? (
          <p className="todayNote">Nothing live on your board right now.</p>
        ) : (
          <div className="listStack">
            {live.map(r => (
              <div className="listItem" key={r.id}>
                <div className="itemInfo">
                  <div className="itemInfoTitleRow">
                    <strong>{r.area_label}</strong>
                    <span className="badge draft">Live</span>
                  </div>
                  <p>Published {fmtTime(r.published_at)} · {r.signed} signed · good until {fmtTime(r.expires_at)}</p>
                </div>
                <div className="itemActions">
                  <button className="btn secondary sm" onClick={() => openFiled(r, true)} disabled={opening === r.id}>{opening === r.id ? 'Opening…' : 'See the JSA'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section label="Done today" count={signedOut ? undefined : doneCount}>
        {(error || openError) && <p className="todayNote">{error || openError}</p>}
        {signedOut ? (
          <p className="todayNote">Sign in up top to see what was finished and filed.</p>
        ) : filed === undefined ? (
          <p className="todayNote">Loading…</p>
        ) : doneCount === 0 ? (
          <p className="todayNote">Nothing finished yet today.</p>
        ) : (
          <div className="listStack">
            {(filed || []).map(r => (
              <div className="listItem" key={r.id}>
                <div className="itemInfo">
                  <div className="itemInfoTitleRow">
                    <strong>{r.employee_name || r.job_site || DOC_LABELS[r.doc_type] || r.doc_type}</strong>
                    <span className="badge ready">{DOC_LABELS[r.doc_type] || r.doc_type}</span>
                  </div>
                  <p>Filed {fmtTime(r.submitted_at)}</p>
                </div>
                <div className="itemActions">
                  <button
                    className="btn secondary sm"
                    onClick={() => openFiled(r)}
                    disabled={opening === r.id}
                  >
                    {opening === r.id ? 'Opening…' : 'Open the PDF'}
                  </button>
                </div>
              </div>
            ))}
            {closed.map(r => (
              <div className="listItem" key={r.id}>
                <div className="itemInfo">
                  <div className="itemInfoTitleRow">
                    <strong>{r.area_label}</strong>
                    <span className="badge ready">Closed</span>
                  </div>
                  <p>Expired {fmtTime(r.expires_at)} · {r.signed} signed</p>
                </div>
                <div className="itemActions">
                  <button className="btn secondary sm" onClick={() => openFiled(r, true)} disabled={opening === r.id}>{opening === r.id ? 'Opening…' : 'See the JSA'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {preview && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Published JSA" style={{ maxWidth: 620, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3 style={{ margin: 0 }}>{preview.area_label}</h3>
            <p className="helperText">{preview.signed} signed · published {fmtTime(preview.published_at)}</p>
            <JsaContents jsa={preview.data} title="Published JSA" />
            <div className="dialogActions">
              <button type="button" className="btn primary" onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
