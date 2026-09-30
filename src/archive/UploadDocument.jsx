import { useState } from 'react';
import { uploadExistingDocument, describeUploadProblem } from './fileToArchive';
import { canFileDocType } from './archiveRoles';

/* ── Add a document that already exists as a file ────────────────────────
   The way years of existing write-ups, separations and incident reports get
   into the archive. They were finished long before this app existed and live
   as PDFs or scans on somebody's computer, so there is no structured data to
   store -- the file is the record, and the person uploading supplies the few
   details that make it findable later: who it is about, which job, and when.

   Built as a permanent feature rather than a one-off import, deliberately.
   A migration script only helps once and only helps whoever can run it; this
   keeps working for the next scanned document somebody gets handed, and
   anybody with a login can use it. */

const TYPES = [
  ['disciplinary', 'Disciplinary Action'],
  ['separation', 'Employee Separation'],
  ['incident', 'Incident Report'],
  ['medicalEvent', 'Medical Event'],
  ['uncontrolledEvent', 'Uncontrolled Event'],
  ['jsa', 'Job Safety Analysis'],
];

export default function UploadDocument({ profile, onDone, onCancel }) {
  /* Only the kinds this account may actually file. Offering the rest let a
     superintendent pick Disciplinary, upload the file, and only THEN be
     refused by the database -- in raw Postgres, with the file left behind
     in storage for good. Same rule as the database; checked again right
     before uploading in uploadExistingDocument(). Audit 2026-09-30. */
  const types = TYPES.filter(([v]) => canFileDocType(profile, v));
  const limited = types.length < TYPES.length;
  const [file, setFile] = useState(null);
  const [fileProblem, setFileProblem] = useState('');
  const [docType, setDocType] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [jobSite, setJobSite] = useState('');
  const [docDate, setDocDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneCount, setDoneCount] = useState(0);

  const canSubmit = file && !fileProblem && docType && !busy;

  function pickFile(picked) {
    setFile(picked);
    setError('');
    setFileProblem(picked ? (describeUploadProblem(picked) || '') : '');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await uploadExistingDocument({ docType, file, employeeName, jobSite, docDate, note });
      setDoneCount(n => n + 1);
      // Keep the type and job site: these get added in batches off one
      // person's hard drive, and retyping the same job for thirty files is
      // how somebody gives up halfway through.
      setFile(null);
      setFileProblem('');
      setEmployeeName('');
      setDocDate('');
      setNote('');
      const input = document.getElementById('arcUploadFile');
      if (input) input.value = '';
    } catch (err) {
      setError(err?.message || 'Could not add it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="arcUpload" onSubmit={submit}>
      <div className="arcTopBar">
        <div className="arcHeading">
          <h2>Add an old document</h2>
          <p>For write-ups, separations and reports finished before this app existed. The file itself is the record — fill in enough to find it again later.</p>
        </div>
        <div className="arcAccount">
          <button type="button" className="btn ghost sm" onClick={onDone}>Back to Records</button>
        </div>
      </div>

      {doneCount > 0 && (
        <div className="arcScope">
          {doneCount} document{doneCount === 1 ? '' : 's'} added. Keep going — the type and job site stay filled in for the next one.
        </div>
      )}

      <div className="arcUploadGrid">
        <label className="arcField arcSpan">
          <span>The file</span>
          <input
            id="arcUploadFile"
            type="file"
            /* No .heic here on purpose: when the list does not ask for it,
               the iPad and iPhone hand over a JPEG instead, which the office
               computer can open. A HEIC that still arrives (a file picked
               on a PC) is converted or refused -- see prepareUploadFile. */
            accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf"
            onChange={e => pickFile(e.target.files?.[0] || null)}
          />
          {fileProblem
            ? <div className="arcErr" role="alert">{fileProblem}</div>
            : <span className="arcHint">A PDF or a photo of the paperwork. Both work. Up to 25 MB.</span>}
        </label>

        <label className="arcField">
          <span>What kind of document</span>
          <select value={docType} onChange={e => setDocType(e.target.value)} required>
            <option value="">Choose one…</option>
            {types.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          {limited && (
            <div className="arcHint">
              {types.length === 1
                ? 'Your account can add JSAs. Write-ups and separations are added by HR; incident, medical and uncontrolled event paperwork by a PM or HR.'
                : 'Only the kinds your account can file are listed. Write-ups and separations are added by HR.'}
            </div>
          )}
        </label>

        <label className="arcField">
          <span>Employee name</span>
          <input value={employeeName} onChange={e => setEmployeeName(e.target.value)} placeholder="Who it's about" />
        </label>

        <label className="arcField">
          <span>Job site</span>
          <input value={jobSite} onChange={e => setJobSite(e.target.value)} placeholder="Where, if it matters" />
        </label>

        <label className="arcField">
          <span>Date on the document</span>
          <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} />
        </label>

        <label className="arcField arcSpan">
          <span>Note (optional)</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth knowing about this one" />
        </label>
      </div>

      <p className="arcHint">
        Employee name and date are what make a document findable years later. Worth filling in
        even when it takes a second — searching for a name is how anybody will look for this.
      </p>

      {error && <div className="arcErr">{error}</div>}

      <div className="arcUploadActions">
        <button type="submit" className="btn primary lg" disabled={!canSubmit}>
          {busy ? 'Adding…' : 'Add to the archive'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel || onDone}>Done adding</button>
      </div>
    </form>
  );
}
