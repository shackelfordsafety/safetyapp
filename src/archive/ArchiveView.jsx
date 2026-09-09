import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from './archiveClient';
import UploadDocument from './UploadDocument';
import './archive.css';

/* ── Company document archive (office side) ──────────────────────────────
   The one part of this app that requires a login and a network. Everything
   else -- creating, filling out and finishing any of the six documents --
   stays login-free, offline and localStorage-only, and nothing in this file
   is imported by that path.

   This whole module is lazy-loaded from main.jsx (React.lazy), so a
   superintendent doing a JSA never downloads it, never runs it, and cannot
   be affected if it breaks.

   Access is enforced by Postgres row-level security, not by this component:
     - a field user sees only the documents they filed
     - safety and hr see everything
     - there is no UPDATE or DELETE policy at all, so a filed document
       cannot be edited or deleted from the app by anybody
   Hiding a button here would not be security; the database is what says no.

   The key below is the *publishable* key, which is designed to ship in
   browser code -- it identifies the project and grants nothing on its own.
   The service key is not used anywhere in this repo. */

const DOC_LABELS = {
  jsa: 'JSA',
  incident: 'Incident',
  disciplinary: 'Disciplinary',
  separation: 'Separation',
  medicalEvent: 'Medical',
  uncontrolledEvent: 'Uncontrolled',
};

function fmtDate(d) {
  if (!d) return '—';
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtWhen(t) {
  if (!t) return '—';
  const parsed = new Date(t);
  return Number.isNaN(parsed.getTime()) ? t : parsed.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// "employeeName" -> "Employee name"
function humanizeKey(k) {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}
/* A captured signature is stored as a data: URL -- several thousand
   characters of base64. Printed as text it buries the actual record under a
   wall of gibberish, which is exactly how it looked in the field
   (2026-09-09). Show that a signature exists and move on; the signature
   itself belongs on the PDF, which is one tap away. */
function isImageData(v) {
  return typeof v === 'string' && v.startsWith('data:image/');
}

function renderValue(v) {
  if (isImageData(v)) return 'Signed';
  if (Array.isArray(v)) return v.map(x => (isImageData(x) ? 'Signed' : x)).join('\n');
  if (v && typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setErr(error.message); return; }
      await onSignedIn();
    } catch (ex) {
      // Never fail silently: an earlier standalone version of this screen
      // could swallow a post-login error and just sit there, which reads as
      // "my password is wrong" and sends somebody looking for help.
      setErr(ex?.message || 'Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="arcLoginWrap">
      <form className="arcLoginCard" onSubmit={submit}>
        <h2>Document Archive</h2>
        <p className="arcLead">Sign in to look up filed safety and employee documents.</p>
        <label className="arcField">
          <span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="arcField">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {err && <div className="arcErr">{err}</div>}
        <button type="submit" className="btn primary lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
        <p className="arcFine">This is the only part of the app that asks anybody to sign in. Filling out documents never does.</p>
      </form>
    </div>
  );
}

function DocumentDetail({ row, onClose }) {
  const uploaded = row.data?.source === 'uploaded';
  const fields = Object.entries(row.data || {}).filter(([k, v]) => {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    // Bookkeeping about the upload itself, not content of the document.
    if (uploaded && (k === 'source' || k === 'uploadedAt')) return false;
    return true;
  });

  const [fileBusy, setFileBusy] = useState(false);
  const [fileErr, setFileErr] = useState('');

  /* The stored file is the actual record -- for a scanned write-up it is
     the ONLY record. The bucket is private, so it can't just be linked;
     ask for a short-lived signed URL and open that. Opening rather than
     force-downloading means a PDF or a photo previews in the browser,
     which is what somebody looking a document up actually wants. */
  async function openFile() {
    setFileBusy(true);
    setFileErr('');
    try {
      const { data, error } = await db.storage
        .from('documents')
        .createSignedUrl(row.pdf_path, 120);
      if (error) throw new Error(error.message);
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (ex) {
      setFileErr(ex?.message || 'Could not open the file. Check your connection and try again.');
    } finally {
      setFileBusy(false);
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(row, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${row.doc_type}_${(row.employee_name || row.job_site || 'document').replace(/[^a-z0-9]+/gi, '_')}_${row.doc_date || ''}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Filed document" style={{ maxWidth: 820, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="arcDetailHead">
          <span className="arcType">{DOC_LABELS[row.doc_type] || row.doc_type}</span>
          <h3 style={{ margin: 0 }}>{row.employee_name || row.job_site || 'Filed document'}</h3>
        </div>

        <div className="arcSectionTitle">Record</div>
        <div className="arcKv">
          <div><span className="k">Document type</span><span className="v">{DOC_LABELS[row.doc_type] || row.doc_type}</span></div>
          <div><span className="k">Employee</span><span className="v">{row.employee_name || '—'}</span></div>
          <div><span className="k">Job site</span><span className="v">{row.job_site || '—'}</span></div>
          <div><span className="k">Document date</span><span className="v">{fmtDate(row.doc_date)}</span></div>
          <div><span className="k">Filed</span><span className="v">{fmtWhen(row.submitted_at)}</span></div>
        </div>

        <div className="arcSectionTitle">
          {uploaded ? 'About this file' : 'The document as it was filed'}
        </div>
        <div className="arcKv">
          {fields.length
            ? fields.map(([k, v]) => (
              <div key={k}><span className="k">{humanizeKey(k)}</span><span className="v">{renderValue(v)}</span></div>
            ))
            : <div><span className="v">No fields recorded.</span></div>}
        </div>
        {uploaded && (
          <p className="arcHint" style={{ marginTop: 8 }}>
            This one was added from existing paperwork, so the file itself is the record.
          </p>
        )}

        {fileErr && <div className="arcErr" style={{ marginTop: 10 }}>{fileErr}</div>}

        <div className="dialogActions">
          {row.pdf_path && (
            <button type="button" className="btn primary" onClick={openFile} disabled={fileBusy}>
              {fileBusy ? 'Opening…' : 'Open the document'}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={download}>Download the details</button>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ArchiveView() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('checking'); // checking | signedout | loading | ready | error
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [opening, setOpening] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  /* Opening the real document is what a tap is for. The bucket is private,
     so it needs a short-lived signed link rather than a plain href. A row
     filed without a PDF (an old record, or one filed before signing) simply
     opens its details instead of doing nothing. */
  async function openPdf(row) {
    if (!row.pdf_path) { setSelected(row); return; }
    setOpening(row.id);
    try {
      const { data, error: err } = await db.storage
        .from('documents')
        .createSignedUrl(row.pdf_path, 120);
      if (err) throw new Error(err.message);
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (ex) {
      setError(ex?.message || 'Could not open that document. Check your connection.');
    } finally {
      setOpening('');
    }
  }
  const [mode, setMode] = useState('browse'); // browse | upload

  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  /* A labelled period dropdown rather than two <input type="date"> boxes.
     On iPad Safari an empty date input still paints today's date, so a pair
     of them reads as "a filter is already applied" when nothing is set, and
     neither box can say which end of the range it is without a visible
     label. A single named period is also what people actually search by. */
  const [period, setPeriod] = useState('');

  const loadEverything = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const { data: userData } = await db.auth.getUser();
      const user = userData?.user;
      if (!user) { setStatus('signedout'); return; }
      setSession(user);

      const { data: prof, error: profErr } = await db.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle();
      if (profErr) throw profErr;
      setProfile(prof || { role: 'field', full_name: null });

      const { data, error: docErr } = await db
        .from('documents')
        .select('id, doc_type, employee_name, job_site, doc_date, submitted_at, data, pdf_path')
        .order('submitted_at', { ascending: false })
        .limit(500);
      if (docErr) throw docErr;

      setRows(data || []);
      setStatus('ready');
    } catch (ex) {
      setError(ex?.message || 'Something went wrong loading the archive.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await db.auth.getSession();
        if (cancelled) return;
        if (data?.session) await loadEverything();
        else setStatus('signedout');
      } catch {
        if (!cancelled) setStatus('signedout');
      }
    })();
    return () => { cancelled = true; };
  }, [loadEverything]);

  async function signOut() {
    await db.auth.signOut();
    setSession(null);
    setProfile(null);
    setRows([]);
    setStatus('signedout');
  }

  const seesAll = profile?.role === 'safety' || profile?.role === 'hr';

  const range = useMemo(() => {
    const iso = d => d.toISOString().slice(0, 10);
    const now = new Date();
    if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: iso(d), to: null }; }
    if (period === '90d') { const d = new Date(now); d.setDate(d.getDate() - 90); return { from: iso(d), to: null }; }
    if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to: null };
    if (period === 'lastyear') return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` };
    return { from: null, to: null };
  }, [period]);

  /* How many of each kind are in here. A library shows you its shelves
     before it shows you every book -- Fonzo, 2026-09-09: "archive should be
     like a library, right now im guessing that docs will just be flooded
     till the end of the page, we need to organize by file types". */
  const counts = useMemo(() => rows.reduce((acc, r) => {
    acc[r.doc_type] = (acc[r.doc_type] || 0) + 1;
    return acc;
  }, {}), [rows]);

  const activeFilters = (period ? 1 : 0) + (q.trim() ? 1 : 0);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (type && r.doc_type !== type) return false;
      if (range.from && (!r.doc_date || r.doc_date < range.from)) return false;
      if (range.to && (!r.doc_date || r.doc_date > range.to)) return false;
      if (needle) {
        const hay = `${r.employee_name || ''} ${r.job_site || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, type, range]);

  if (status === 'checking' || status === 'loading') {
    return <div className="page"><p className="helperText">Loading the archive…</p></div>;
  }

  if (status === 'signedout') {
    return <div className="page"><SignIn onSignedIn={loadEverything} /></div>;
  }

  if (status === 'error') {
    return (
      <div className="page">
        <div className="arcErr" style={{ marginBottom: 14 }}>{error}</div>
        <button type="button" className="btn primary" onClick={loadEverything}>Try again</button>
        <button type="button" className="btn ghost" onClick={signOut} style={{ marginLeft: 8 }}>Sign out</button>
      </div>
    );
  }

  if (mode === 'upload') {
    return (
      <div className="page">
        <UploadDocument
          onDone={async () => { setMode('browse'); await loadEverything(); }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="arcTopBar">
        <div className="arcHeading">
          <h2>Document Archive</h2>
          <p>Every safety and employee document, filed from the app or added from older paperwork.</p>
        </div>
        <div className="arcAccount">
          <div className="arcWho">
            <strong>{profile?.full_name || session?.email}</strong>
            {/* Only worth a second line when it says something the first
                one didn't -- the name falls back to the email itself. */}
            {profile?.full_name ? <span>{session?.email}</span> : null}
          </div>
          <span className="arcRole">{profile?.role || 'field'}</span>
          <button type="button" className="btn ghost sm" onClick={() => setMode('upload')}>Add an old document</button>
          <button type="button" className="btn ghost sm" onClick={loadEverything}>Refresh</button>
          <button type="button" className="btn ghost sm" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="arcScope">
        {seesAll
          ? 'You can see every document filed by everybody.'
          : 'You can see the documents you filed. Safety and HR can see everything.'}
      </div>

      {/* Search stays on the surface -- "find everything on this person"
          is the move -- while the narrowing controls move into a popup so
          the page is not three dropdowns before you reach a document. */}
      <div className="arcSearchBar">
        <input
          className="arcSearchInput"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search an employee or job site"
        />
        <button type="button" className="btn ghost" onClick={() => setShowFilters(true)}>
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {/* The shelves. Shown until something narrows the view, so opening
         the archive is "which kind of document?" rather than a wall of
         every document ever filed. */}
      {!type && !q.trim() && !period ? (
        <>
          <div className="arcShelves">
            {Object.entries(DOC_LABELS).map(([k, label]) => (
              <button type="button" className="arcShelf" key={k} onClick={() => setType(k)} disabled={!counts[k]}>
                <span className="arcShelfCount">{counts[k] || 0}</span>
                <span className="arcShelfName">{label}</span>
              </button>
            ))}
          </div>
          <div className="arcCount">Most recent</div>
        </>
      ) : (
        <div className="arcResultsHead">
          <button type="button" className="btn ghost sm" onClick={() => { setType(''); setQ(''); setPeriod(''); }}>
            &lsaquo; All documents
          </button>
          <span className="arcCount">
            {visible.length} {type ? (DOC_LABELS[type] || type) : 'document'}{visible.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="arcEmpty">
          {rows.length === 0 ? (
            <>
              <strong>Nothing filed yet</strong>
              <span>Documents land here as they are submitted from the field. Older paperwork can go in too — use “Add an old document” up top.</span>
            </>
          ) : (
            <>
              <strong>Nothing matches</strong>
              <span>No documents match what you searched for. Try clearing the filters.</span>
            </>
          )}
        </div>
      ) : (
        <div className="arcTableWrap">
          <table className="arcTable">
            <thead>
              <tr>
                <th>Type</th><th>Employee</th><th>Job site</th><th>Document date</th><th>Filed</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {/* Tapping a row opens the actual document, not a field dump.
                  Fonzo, 2026-09-09: "when u tap in the archive, maybe have it
                  pop up the PDF too, this simple read stuff is good but not
                  for everything." The field list is still reachable, it is
                  just no longer what a tap gets you. */}
              {visible.map(r => (
                <tr key={r.id} onClick={() => openPdf(r)} style={{ cursor: r.pdf_path ? 'pointer' : 'default' }}>
                  <td>
                    <span className="arcType">{DOC_LABELS[r.doc_type] || r.doc_type}</span>
                    {r.data?.source === 'uploaded' && <span className="arcUploaded">Uploaded</span>}
                  </td>
                  <td>{r.employee_name || '—'}</td>
                  <td>{r.job_site || '—'}</td>
                  <td>{fmtDate(r.doc_date)}</td>
                  <td>{fmtWhen(r.submitted_at)}</td>
                  <td className="arcRowActions" onClick={e => e.stopPropagation()}>
                    {r.pdf_path && (
                      <button type="button" className="btn secondary sm" onClick={() => openPdf(r)} disabled={opening === r.id}>
                        {opening === r.id ? 'Opening…' : 'Open'}
                      </button>
                    )}
                    <button type="button" className="btn ghost sm" onClick={() => setSelected(r)}>Details</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showFilters && (
        <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowFilters(false); }}>
          <div className="dialogPanel" role="dialog" aria-modal="true" aria-label="Filters" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: 0 }}>Filters</h3>
            <label className="arcField">
              <span>Document type</span>
              <select value={type} onChange={e => setType(e.target.value)}>
                <option value="">Every type</option>
                {Object.entries(DOC_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="arcField">
              <span>Time period</span>
              <select value={period} onChange={e => setPeriod(e.target.value)}>
                <option value="">Any time</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 3 months</option>
                <option value="year">This year</option>
                <option value="lastyear">Last year</option>
              </select>
            </label>
            <div className="dialogActions">
              <button type="button" className="btn ghost" onClick={() => { setType(''); setQ(''); setPeriod(''); }}>Clear</button>
              <button type="button" className="btn primary" onClick={() => setShowFilters(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {selected && <DocumentDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
