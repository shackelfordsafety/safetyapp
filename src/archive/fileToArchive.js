import { db } from './archiveClient';
import { blockInDemo } from '../shared/demoMode';
import { ARCHIVE_FILING_ENABLED } from './filingEnabled';

/* ── Filing a finished document to the company archive ───────────────────
   Everything here runs only when somebody actually taps "File to archive".
   This module is always reached through a dynamic import() from the
   workflow, so neither it nor the Supabase library it pulls in ever reaches
   the main bundle -- filling out a document stays login-free and offline.

   Nothing in here can lose work: the document is already saved on the
   device before any of this runs, and a failed upload leaves that untouched.
   The user simply tries again when they have signal.

   IMPORTANT -- why this is a single insert rather than insert-then-update:
   the archive has no UPDATE policy at all (that absence is what makes a
   filed document permanent), so a row cannot be written first and have its
   pdf_path filled in afterwards. Instead the row id is generated here, the
   PDF is uploaded to <user id>/<row id>.pdf, and only then is the row
   inserted with pdf_path already set. Upload-then-insert is the deliberate
   order: a failed insert leaves an unreferenced file, which is harmless,
   whereas insert-then-failed-upload would leave a record pointing at a PDF
   that does not exist. */

export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to file this document to the archive.');
    this.name = 'NotSignedInError';
  }
}

/* Which fields make each document findable later. HR looks things up by
   person; the field side looks things up by job. Field names are the real
   ones from each model file -- see emptyDisciplinary(), emptySeparation(),
   emptyMedicalEvent(), emptyUncontrolledEvent(), emptyIncident(), emptyJsa(). */
const SUMMARY = {
  jsa: m => ({
    employee_name: null,
    job_site: m.jobSite || m.location || null,
    doc_date: m.date || null,
  }),
  incident: m => ({
    // injuredPartyName, not employeeName -- an incident's subject isn't
    // always an employee, and the model has never called it that.
    employee_name: m.injuredPartyName || null,
    job_site: m.workplaceLocation || null,
    doc_date: m.incidentDate || null,
  }),
  disciplinary: m => ({
    employee_name: m.employeeName || null,
    // The disciplinary notice genuinely has no location field -- employee,
    // supervisor, position and date are all it collects. Left null rather
    // than invented; these get found by name, which is what HR searches.
    job_site: null,
    doc_date: m.noticeDate || null,
  }),
  separation: m => ({
    employee_name: m.employeeName || null,
    job_site: m.projectLocation || null,
    doc_date: m.lastDayWorked || null,
  }),
  medicalEvent: m => ({
    employee_name: m.employeeName || null,
    job_site: m.projectLocation || null,
    doc_date: m.eventDate || null,
  }),
  uncontrolledEvent: m => ({
    employee_name: null,
    job_site: m.workplaceLocation || null,
    doc_date: m.eventDate || null,
  }),
};

function blank(v) {
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
}

export async function getArchiveUser() {
  try {
    const { data } = await db.auth.getUser();
    return data?.user || null;
  } catch {
    return null;
  }
}

export async function signInToArchive(email, password) {
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message);
  return getArchiveUser();
}

/* Resolves to { id } on success. Throws NotSignedInError if there is no
   session, or a plain Error with a readable message for anything else --
   the caller shows it and offers a retry. */
export async function fileDocument({ docType, model, pdfBlob }) {
  blockInDemo(`Filing to the archive`);

  /* Belt and braces behind the hidden buttons. The archive cannot edit or
     delete, so a half-finished document filed by a path I forgot to hide
     is wrong forever -- see filingEnabled.js.

     JSAs are exempt and must stay exempt: they file themselves when a
     published one expires, which is the auto-archive the night crew
     depends on, and they are complete by definition at that point --
     the shift ended and the crew signed. */
  if (docType !== 'jsa' && !ARCHIVE_FILING_ENABLED) {
    throw new Error('Filing to the archive is switched off for now. Download or print it — nothing is lost.');
  }
  const user = await getArchiveUser();
  if (!user) throw new NotSignedInError();

  const summarize = SUMMARY[docType];
  if (!summarize) throw new Error(`Unknown document type "${docType}".`);
  const summary = summarize(model || {});

  const id = (crypto.randomUUID && crypto.randomUUID())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${user.id}/${id}.pdf`;

  if (pdfBlob) {
    const { error: uploadError } = await db.storage
      .from('documents')
      .upload(path, pdfBlob, { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw new Error(`Could not upload the PDF: ${uploadError.message}`);
  }

  const { error: insertError } = await db.from('documents').insert({
    id,
    doc_type: docType,
    submitted_by: user.id,
    employee_name: blank(summary.employee_name),
    job_site: blank(summary.job_site),
    doc_date: blank(summary.doc_date),
    data: model,
    client_doc_id: model?.id || null,
    pdf_path: pdfBlob ? path : null,
  });
  if (insertError) throw new Error(`Could not file the document: ${insertError.message}`);

  return { id };
}

/* ── Filing a document that already exists as a file ─────────────────────
   For the years of write-ups, separations and incident reports that were
   finished long before this app existed and are sitting on somebody's hard
   drive. Same destination and the same rules as fileDocument() above -- the
   only difference is that there is no structured data to store, so the file
   itself is the whole record and a person supplies the few details that make
   it findable.

   Marked with source: 'uploaded' in `data` so the archive can be honest
   about where a record came from. A generated document and a scanned one
   are not the same kind of evidence, and somebody reading this in two years
   should be able to tell them apart. */
export async function uploadExistingDocument({ docType, file, employeeName, jobSite, docDate, note }) {
  blockInDemo(`Adding a document to the archive`);
  const user = await getArchiveUser();
  if (!user) throw new NotSignedInError();
  if (!file) throw new Error('Choose a file first.');
  if (!SUMMARY[docType]) throw new Error('Pick which kind of document this is.');

  const id = (crypto.randomUUID && crypto.randomUUID())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'pdf';
  const path = `${user.id}/${id}.${ext || 'pdf'}`;

  const { error: uploadError } = await db.storage
    .from('documents')
    .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (uploadError) throw new Error(`Could not upload the file: ${uploadError.message}`);

  const { error: insertError } = await db.from('documents').insert({
    id,
    doc_type: docType,
    submitted_by: user.id,
    employee_name: blank(employeeName),
    job_site: blank(jobSite),
    doc_date: blank(docDate),
    data: {
      source: 'uploaded',
      originalFilename: file.name,
      uploadedAt: new Date().toISOString(),
      note: blank(note) || undefined,
    },
    pdf_path: path,
  });
  if (insertError) throw new Error(`Could not file the document: ${insertError.message}`);

  return { id };
}

/* Everything filed to the archive today, for the Today view.

   Returns null when nobody is signed in -- that is not an error, it is the
   normal state of a device that only builds documents, and the caller
   shows a quieter "sign in to see the rest" note instead of a failure.

   Row-level security decides whose documents come back: your own if you
   are a superintendent, everybody's if you are safety, HR or a PM. */
export async function fetchFiledToday() {
  const user = await getArchiveUser();
  if (!user) return null;

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { data, error } = await db
    .from('documents')
    .select('id, doc_type, employee_name, job_site, doc_date, submitted_at, data, pdf_path')
    .gte('submitted_at', since.toISOString())
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/* A short-lived link to a filed document's PDF.

   The bucket is private, so a stored file cannot simply be linked to --
   every view has to mint its own signed URL. Shared here rather than
   duplicated in each screen that offers a download. */
export async function signedUrlFor(pdfPath, seconds = 120) {
  if (!pdfPath) return null;
  const { data, error } = await db.storage.from('documents').createSignedUrl(pdfPath, seconds);
  if (error) throw new Error(error.message);
  return data?.signedUrl || null;
}
