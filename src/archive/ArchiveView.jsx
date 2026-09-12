import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from './archiveClient';
import UploadDocument from './UploadDocument';
import './archive.css';
import HelpButton from '../shared/HelpButton';
import { notifySessionChanged } from '../shared/session';

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

/* Crew sign-in is stored as [{ dataUrl, signedAt }] -- the signature image
   plus when it was made. Rendered naively that came out as a list of
   "[object Object]", so the one thing a reader actually wants to know from
   this section -- did the crew sign, and when -- was the one thing missing
   (Fonzo, 2026-09-09: "just doesn't show on the details easy reader").
   The signatures themselves are on the PDF, which is one tap away. */
function isSignatureList(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object' && 'dataUrl' in x);
}

function renderSignatureList(v) {
  const times = v
    .map(s => {
      const d = new Date(s.signedAt);
      return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    })
    .filter(Boolean);
  const head = `${v.length} signed`;
  if (!times.length) return head;
  return `${head} — first at ${times[0]}, last at ${times[times.length - 1]}`;
}

function renderValue(v) {
  if (isImageData(v)) return 'Signed';
  if (isSignatureList(v)) return renderSignatureList(v);
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
      /* Tell the rest of the app, or the account chip in the corner keeps
         calling this person a guest while they read role-gated records. */
      notifySessionChanged();
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
        <h2>Records</h2>
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
  /* The list no longer carries every document's whole body -- it was
     downloading all of them to read one field, which is what made the
     archive slow to open on a job-trailer connection. The body is fetched
     here instead, for the one document somebody actually opened. */
  const [body, setBody] = useState(row.data || null);
  useEffect(() => {
    if (row.data) { setBody(row.data); return undefined; }
    let alive = true;
    db.from('documents').select('data').eq('id', row.id).maybeSingle()
      .then(({ data }) => { if (alive) setBody(data?.data || {}); })
      .catch(() => { if (alive) setBody({}); });
    return () => { alive = false; };
  }, [row.id, row.data]);

  const uploaded = body?.source === 'uploaded';
  const fields = Object.entries(body || {}).filter(([k, v]) => {
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
    const blob = new Blob([JSON.stringify({ ...row, data: body || {} }, null, 2)], { type: 'application/json' });
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
          {/* Both, on the detail panel. The list has one narrow column and
              has to choose; a document you have actually opened has room
              to say the job number AND where it was. */}
          {row.jobNumber && <div><span className="k">Job #</span><span className="v">{row.jobNumber}</span></div>}
          <div><span className="k">Job site</span><span className="v">{row.job_site || '—'}</span></div>
          <div><span className="k">Document date</span><span className="v">{fmtDate(row.doc_date)}</span></div>
          <div><span className="k">Filed</span><span className="v">{fmtWhen(row.submitted_at)}</span></div>
          <div><span className="k">Filed by</span><span className="v">{row.filedByName || 'Not recorded'}</span></div>
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
  /* Non-zero only if the archive ever grows past the page-through ceiling.
     Shown on screen, because a search over part of the archive that says
     nothing is how you lose a record. */
  const [truncatedAt, setTruncatedAt] = useState(0);
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

      /* Two things used to be wrong here, both found by an outside
         reviewer on 2026-09-11.

         It asked for the newest 500 and stopped. Searching happens on what
         came back, so the 501st document was not missing from the list --
         it was missing from every SEARCH, silently, with nothing on screen
         to say so. An archive you cannot trust to find a record is not an
         archive.

         And it pulled the whole body of every document down to read ONE
         field out of it. On a job-trailer connection that is the
         difference between the screen opening and the screen hanging.

         So: ask the database for the two fields actually needed out of the
         body, and page through the whole thing rather than stopping at an
         arbitrary line. The full body is fetched only for the one document
         somebody opens. */
      const PAGE = 1000;
      /* A ceiling so a runaway cannot lock up an iPad. Ten thousand
         documents is years of this company's paperwork; if it is ever
         reached the screen says so rather than quietly cutting the search
         short, which was the whole bug. */
      const CEILING = 10000;
      const data = [];
      let truncated = false;
      for (let from = 0; from < CEILING; from += PAGE) {
        const { data: page, error: docErr } = await db
          .from('documents')
          .select('id, doc_type, employee_name, job_site, doc_date, submitted_at, submitted_by, pdf_path, jobNumber:data->>jobNumber, source:data->>source')
          .order('submitted_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (docErr) throw docErr;
        data.push(...(page || []));
        if (!page || page.length < PAGE) break;
        if (from + PAGE >= CEILING) truncated = true;
      }
      setTruncatedAt(truncated ? data.length : 0);

      /* Who filed each one. The archive showed documents with no author at
         all, so an owner opening it could not tell whether a clerk wrote
         something or a foreman did -- which is most of what he wants to
         know. Fetched in one go and joined here: submitted_by points at
         auth.users and profiles points at auth.users, and PostgREST cannot
         infer a relationship between two tables that merely share a
         target. */
      const docs = data || [];
      const filerIds = [...new Set(docs.map(d => d.submitted_by).filter(Boolean))];
      const filers = {};
      if (filerIds.length) {
        const { data: people } = await db.from('profiles').select('id, full_name').in('id', filerIds);
        (people || []).forEach((person) => { filers[person.id] = person.full_name; });
      }
      /* Job number, pulled out of the document itself. Fonzo, 2026-09-11:
         "instead of filtering by job site, change that to job #, easier to
         notice which jobs we have."

         It is not a column on public.documents -- it lives inside `data`,
         and only the JSA asks for one at all. The other five document
         types have no job-number field, so those rows fall back to the job
         site rather than showing an empty column that makes the archive
         look broken. */
      setRows(docs.map(d => ({
        ...d,
        filedByName: filers[d.submitted_by] || null,
        jobNumber: String(d.jobNumber || '').trim(),
      })));
      setStatus('ready');
    } catch (ex) {
      setError(ex?.message || 'Something went wrong loading your records.');
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

  /* The second sign-out in the app. It has to do exactly what the account
     chip's does, or signing out from Records would leave the very
     paperwork the other one exists to clear -- which is the shape of bug
     that gets found by a person and not by a test. See clearOnSignOut.js. */
  async function signOut() {
    const { unfinishedOnThisDevice, clearWorkFromThisDevice } = await import('../shared/clearOnSignOut');
    const unfinished = unfinishedOnThisDevice();
    if (unfinished.length) {
      const list = unfinished.map(x => `  • ${x}`).join('\n');
      const ok = window.confirm(
        `Signing out removes unfinished paperwork from this device:\n\n${list}\n\n`
        + 'This is so the next person to pick it up cannot read it. Anything you '
        + 'have already submitted is safe on your account.\n\nSign out and remove it?'
      );
      if (!ok) return;
    }
    await db.auth.signOut();
    notifySessionChanged();
    clearWorkFromThisDevice();
    setSession(null);
    setProfile(null);
    setRows([]);
    setStatus('signedout');
    window.location.reload();
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
        const hay = `${r.employee_name || ''} ${r.jobNumber || ''} ${r.job_site || ''} ${r.filedByName || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, type, range]);

  if (status === 'checking' || status === 'loading') {
    return <div className="page"><p className="helperText">Loading records…</p></div>;
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
          <div className="titleWithHelp">
            <h2>Records</h2>
            <HelpButton title="Records">
              <p>
                Every finished document the company has filed — JSAs, incidents, write-ups, all of
                it. This is the permanent copy.
              </p>
              <p>
                <strong>Nothing in here can be changed or deleted, by anybody.</strong> That is on
                purpose. A record of what happened is only worth having if it cannot be quietly
                edited later.
              </p>
              <p><strong>Finding something:</strong></p>
              <ul>
                <li>Type a person&apos;s name, a job site, or who filed it in the search box.</li>
                <li>Use <strong>Filters</strong> to narrow to a date range.</li>
                <li>Tap any row to open the actual document.</li>
              </ul>
              <p>
                What you can see depends on your job. Safety, HR, the PM, clerks and the owners see
                everything. Superintendents and foremen see their own work, plus every disciplinary
                form.
              </p>
            </HelpButton>
          </div>
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

      {/* Said out loud, never assumed. If the archive ever outgrows what
          one screen loads, searching it stops being complete -- and a
          search you believe is complete when it is not is how a record
          goes missing. */}
      {truncatedAt > 0 && (
        <div className="arcErr">
          Showing the newest {truncatedAt.toLocaleString()} documents. There are older ones
          this search is not looking at — narrow it down by type or period, or ask for the
          archive to be searched properly.
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
                <th>Type</th><th>Employee</th><th>Job #</th><th>Document date</th><th>Filed</th><th>Filed by</th><th aria-label="Actions" />
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
                    {r.source === 'uploaded' && <span className="arcUploaded">Uploaded</span>}
                  </td>
                  <td>{r.employee_name || '—'}</td>
                  {/* Job # where the document carries one -- only the JSA
                      asks for it today. The five others fall back to the
                      job site rather than showing an empty column, which
                      would make the archive look broken. */}
                  <td>{r.jobNumber || (r.job_site ? <span className="arcFallback">{r.job_site}</span> : '—')}</td>
                  <td>{fmtDate(r.doc_date)}</td>
                  <td>{fmtWhen(r.submitted_at)}</td>
                  <td>{r.filedByName || <span className="arcNoFiler">Not recorded</span>}</td>
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
