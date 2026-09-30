import { db } from './archiveClient';
import { blockInDemo } from '../shared/demoMode';
import { ARCHIVE_FILING_ENABLED } from './filingEnabled';
import { notifySessionChanged } from '../shared/session';
import { canFileDocType, whoCanFile } from './archiveRoles';

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
  if (!error) notifySessionChanged();
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

/* ── What an uploaded file may be ─────────────────────────────────────────
   Checked BEFORE anything is uploaded, because an upload cannot be taken
   back: the bucket has no delete, so every refused attempt used to leave
   another orphan file behind. Audit 2026-09-30. */

/* 25 MB. A phone photo of a page is 2-5 MB and a multi-page scan rarely
   passes 10; anything bigger is almost always a scanner left on its
   highest setting, and it is slow to open for whoever looks it up later. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/* What the office computer, and any browser, can open. Anything else is
   refused with a plain instruction rather than guessed at -- this used to
   label ANY file with no recognisable type as a PDF, which stored it under
   a lie and it would not open. */
const TYPE_BY_EXT = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif',
};
const EXT_BY_TYPE = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/tiff': 'tif',
};
const SAVE_AS_HINT = 'Save it as a PDF or JPG first, then add that.';

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? String(name).slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

function contentTypeOf(file) {
  const declared = String(file?.type || '').toLowerCase();
  if (declared && declared !== 'application/octet-stream') return declared;
  return TYPE_BY_EXT[extOf(file?.name)] || '';
}

function isHeic(type) {
  return type === 'image/heic' || type === 'image/heif'
    || type === 'image/heic-sequence' || type === 'image/heif-sequence';
}

function megabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
}

/* The checks that need no network, in words, or null when the file is
   fine to try. The upload screen calls this the moment a file is picked so
   the problem shows before anybody fills in the rest of the form. */
export function describeUploadProblem(file) {
  if (!file) return null;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${megabytes(file.size)} MB — the limit is 25 MB. Scan it again at a lower quality setting, or split it into a few smaller files.`;
  }
  if (file.size === 0) return 'That file is empty. Pick it again, or save a fresh copy first.';
  const type = contentTypeOf(file);
  if (!type) return `We can’t tell what kind of file “${file.name}” is. ${SAVE_AS_HINT}`;
  if (!isHeic(type) && !EXT_BY_TYPE[type]) {
    return `“${file.name}” isn’t a PDF or a photo, so it may not open on the office computer. ${SAVE_AS_HINT}`;
  }
  return null;
}

/* iPhone and iPad photos are HEIC, which the office Windows PC cannot
   open -- a record nobody can read is not much of a record. Converted to
   JPEG right here when this browser can read HEIC itself (Safari on the
   iPad and iPhone can, which is where these come from). Where it cannot
   (Chrome or Edge on Windows), refused with an instruction instead of
   storing a file that will not open. No library: the browser either
   decodes it or it does not.

   Scaled to at most 4096 px on the long side and 16 megapixels, which
   keeps a page photo sharp and stays under the canvas size iPad Safari
   will actually draw (bigger canvases come back blank, silently). */
async function heicToJpeg(file) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 4096 / Math.max(w, h), Math.sqrt(16000000 / (w * h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    canvas.width = 0; canvas.height = 0; // hand the memory back on iPad
    return blob && blob.size ? blob : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Resolves to { body, contentType, ext, convertedFrom } ready to upload,
   or throws a plain-English Error saying what to do instead. */
export async function prepareUploadFile(file) {
  const problem = describeUploadProblem(file);
  if (problem) throw new Error(problem);
  const type = contentTypeOf(file);
  if (isHeic(type)) {
    const jpeg = await heicToJpeg(file);
    if (!jpeg) {
      throw new Error('That photo is in Apple’s HEIC format, which the office computer can’t open, and this browser can’t convert it. '
        + 'Save it as a JPG or PDF first — or add it from the iPad or iPhone it was taken on.');
    }
    if (jpeg.size > MAX_UPLOAD_BYTES) throw new Error(`That photo is still ${megabytes(jpeg.size)} MB after converting — the limit is 25 MB.`);
    return { body: jpeg, contentType: 'image/jpeg', ext: 'jpg', convertedFrom: 'heic' };
  }
  const contentType = type === 'image/jpg' || type === 'image/pjpeg' ? 'image/jpeg' : type;
  /* supabase-js uploads a File/Blob as multipart and IGNORES the
     contentType option for it -- the stored type is the Blob's own. A
     file with no declared type would be stored as octet-stream and not
     open in a browser, so it is re-wrapped with the right one (no copy of
     the bytes). */
  const body = file.type === contentType ? file : new Blob([file], { type: contentType });
  return { body, contentType, ext: EXT_BY_TYPE[type], convertedFrom: null };
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
  if (!file) throw new Error('Choose a file first.');
  if (!SUMMARY[docType]) throw new Error('Pick which kind of document this is.');
  const fileProblem = describeUploadProblem(file);
  if (fileProblem) throw new Error(fileProblem);

  const user = await getArchiveUser();
  if (!user) throw new NotSignedInError();

  /* Asked fresh, right before uploading, rather than trusting the list the
     screen was drawn from: a role can be changed while this page is open.
     The database refuses the row anyway -- but only AFTER the file is in
     the bucket, which cannot delete it, and with a message in Postgres. */
  const { data: me, error: meErr } = await db
    .from('profiles').select('role, is_admin').eq('id', user.id).maybeSingle();
  if (meErr) throw new Error('Could not check what your account is allowed to file. Check your signal and try again — nothing was uploaded.');
  if (!canFileDocType(me || { role: 'field' }, docType)) {
    throw new Error(`Your account can’t file this kind of document — only ${whoCanFile(docType)} can. Nothing was uploaded. Ask HR if your role should be different.`);
  }

  const prepared = await prepareUploadFile(file);

  const id = (crypto.randomUUID && crypto.randomUUID())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${user.id}/${id}.${prepared.ext}`;

  const { error: uploadError } = await db.storage
    .from('documents')
    .upload(path, prepared.body, { contentType: prepared.contentType, upsert: false });
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
      convertedFrom: prepared.convertedFrom || undefined,
    },
    pdf_path: path,
  });
  if (insertError) {
    if (/row-level security/i.test(insertError.message || '')) {
      throw new Error(`The archive refused it: your account can’t file this kind of document — only ${whoCanFile(docType)} can. Ask HR if your role should be different.`);
    }
    throw new Error(`Could not file the document: ${insertError.message}`);
  }

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
    /* Summary columns only. `data` used to be in here, and `data` is the
       whole document -- for a JSA that is every crew signature stored as an
       image inside the record, 1.5 to 2.9 MB apiece on real ones.

       This query runs on Home AND again on My Work, to draw a count and a
       line of text per row. On 2026-09-14 that meant downloading and
       unpacking 1.77 MB to render two lines, twice. Pat's screen went black
       for about five seconds after a refresh; it was this, on an office
       desktop, not a slow connection.

       Nothing read it. The only preview that uses a document body reads it
       from jsa_publications, and Records already fetches one row's `data`
       on demand when somebody actually opens it -- same pattern, which is
       what this should have been doing all along. It would have got worse
       every week: a JSA a day is ~2 MB a day added to this screen. */
    .select('id, doc_type, employee_name, job_site, doc_date, submitted_at, pdf_path')
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
