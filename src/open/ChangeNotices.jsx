import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './opendocs.css';

/* ── "Pat Foster changed 2 things on your incident report" ───────────────
   The approver is the end of the line and does not wait for anybody --
   Fonzo, 2026-09-11: "if they make changes the sender just hits got it and
   that's it. got it doesn't hold up the document." So this is not an
   approval step. It is a receipt.

   What it is for, in his words: "so someone can't be like 'i never saw
   that' type shi." Which means it has to show the actual words -- before
   and after, field by field -- not "your document was updated". A notice
   you cannot check is not evidence that anybody checked it.

   It sits at the top of My Work and stays there until tapped. Renders
   nothing when there is nothing, which is almost always. */

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `today at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const DOC_LABELS = {
  jsa: 'JSA',
  incident: 'incident report',
  disciplinary: 'disciplinary notice',
  separation: 'separation form',
  medicalEvent: 'medical event form',
  uncontrolledEvent: 'uncontrolled event form',
};

export default function ChangeNotices() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const mod = await loadModule(() => import('./openDocs'));
      if (!mod) return;
      setRows(await mod.myUnacknowledgedChanges());
    } catch {
      /* Signed out, or no signal. Neither is worth a banner on a screen
         that already handles both. */
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function gotIt(id) {
    setBusy(id);
    setError('');
    try {
      const mod = await loadModule(() => import('./openDocs'));
      await mod.acknowledgeChange(id);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (ex) {
      setError(ex?.message || 'Could not mark it seen. Check your signal.');
    } finally {
      setBusy('');
    }
  }

  if (!rows.length) return null;

  return (
    <div className="noticeStack">
      {rows.map((r) => {
        const changes = Array.isArray(r.changes) ? r.changes : [];
        return (
          <div className="noticeCard" key={r.id}>
            <div className="noticeHead">
              <strong>
                {r.editedByName} changed {changes.length === 1 ? '1 thing' : `${changes.length} things`} on
                {' '}your {DOC_LABELS[r.doc_type] || 'document'}
              </strong>
              <span className="noticeWhen">{fmtWhen(r.edited_at)}</span>
            </div>

            <ul className="noticeChanges">
              {changes.map((c, i) => (
                <li key={`${c.field}-${i}`}>
                  <span className="noticeField">{c.label || c.field}</span>
                  <span className="noticeBefore">{c.before}</span>
                  <span className="noticeArrow" aria-hidden="true">→</span>
                  <span className="noticeAfter">{c.after}</span>
                </li>
              ))}
            </ul>

            {error && <p className="archiveError">{error}</p>}
            <div className="noticeActions">
              <button
                type="button"
                className="btn primary sm"
                onClick={() => gotIt(r.id)}
                disabled={busy === r.id}
              >
                {busy === r.id ? 'Saving…' : 'Got it'}
              </button>
              <span className="helperText">
                This is a heads-up, not a hold-up — the document carries on either way.
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
