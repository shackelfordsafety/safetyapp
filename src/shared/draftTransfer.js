import { localISODate } from './localDate';
/* ── Field-to-office draft handoff ──
   Lets a superintendent/foreman export the document they're working on as a
   small editable file (NOT a PDF — the PDF is a flattened, unreadable-by-
   this-app dead end), send it however they already send files (text, email,
   AirDrop), and lets whoever receives it import it straight into their own
   copy of the app to keep editing — instead of retyping everything from
   scratch. Pure data-shape helpers only, no React, so both main.jsx and
   every src/documents/<name>/*Workflow.jsx can import it directly.

   Deliberately NOT a substitute for the app's own localStorage
   drafts/templates: this only ever produces/consumes the same JSON shape
   each document type already reads/writes to localStorage, wrapped in one
   small envelope so an import can identify what kind of document a file is
   and reject anything that clearly isn't one, before ever touching app
   state — see the Gotchas note in CLAUDE.md about wrong-shaped values from
   localStorage causing white screens; a file from an external source is
   less trustworthy than that already-accepted risk, so this validates the
   envelope up front rather than trusting it the way loadSavedDraft() trusts
   this device's own localStorage. */

export const DRAFT_EXPORT_KIND = 'sdc-field-draft';
// Separate kind (not reusing DRAFT_EXPORT_KIND) so a template file can never
// be accidentally imported as if it were a live in-progress draft, or vice
// versa -- a template deliberately lacks day-specific fields (date, times,
// signatures), which is correct for a template but would be a confusing,
// half-blank "draft" if it landed in the single active-draft slot instead
// of the templates list (Fonzo, 2026-08-17/18: "Send to Someone Else to
// Finish" doesn't fit JSAs -- whoever starts one finishes it -- but sharing
// a saved template with someone else is a real, different thing).
export const TEMPLATE_EXPORT_KIND = 'sdc-field-template';

const KNOWN_DOC_TYPES = ['jsa', 'incident', 'disciplinary', 'uncontrolledEvent', 'medicalEvent', 'separation'];

export function sanitizeForFilename(str) {
  return String(str || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Untitled';
}

export function buildDraftFilename(identifyingName, typeLabel, date) {
  const day = date || localISODate();
  return `${sanitizeForFilename(identifyingName)}_${sanitizeForFilename(typeLabel)}_Draft_${day}`;
}

// Triggers a real file download the same way every PDF/export download in
// this app already works (Blob + object URL + synthetic <a click>) — no new
// download mechanism, just a different payload.
export function downloadDraftFile(docType, data, baseFilename) {
  const payload = {
    kind: DRAFT_EXPORT_KIND,
    docType,
    schemaVersion: data?.schemaVersion ?? null,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseFilename}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Same mechanics as downloadDraftFile, different envelope kind -- see
// TEMPLATE_EXPORT_KIND above for why these can't share one kind.
export function downloadTemplateFile(docType, data, baseFilename) {
  const payload = {
    kind: TEMPLATE_EXPORT_KIND,
    docType,
    schemaVersion: data?.schemaVersion ?? null,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseFilename}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

// Envelope-level validation only (kind/docType/data shape) — deliberately
// does NOT deep-validate every field of `data`. Once accepted, `data` is
// spread onto that document type's own empty<Type>() defaults exactly like
// this device's own localStorage drafts already are (see loadSavedDraft/
// loadSaved in main.jsx and useDraftDocument.js) — same tolerance the app
// already relies on, not a new validation tier to maintain.
export function parseDraftFileText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a valid Safety Documentation Center draft file." };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.kind !== DRAFT_EXPORT_KIND) {
    return { ok: false, error: "That file isn't a Safety Documentation Center draft file." };
  }
  if (typeof parsed.docType !== 'string' || !KNOWN_DOC_TYPES.includes(parsed.docType)) {
    return { ok: false, error: "This draft file's document type isn't recognized. It may be from a newer version of the app." };
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return { ok: false, error: 'This draft file is missing its document data.' };
  }
  return { ok: true, docType: parsed.docType, data: parsed.data };
}

// Mirrors parseDraftFileText exactly, checked against TEMPLATE_EXPORT_KIND
// instead -- see the constant above for why templates and drafts use
// different envelope kinds rather than sharing one.
export function parseTemplateFileText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a valid Safety Documentation Center template file." };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.kind !== TEMPLATE_EXPORT_KIND) {
    return { ok: false, error: "That file isn't a Safety Documentation Center template file." };
  }
  if (typeof parsed.docType !== 'string' || !KNOWN_DOC_TYPES.includes(parsed.docType)) {
    return { ok: false, error: "This template file's document type isn't recognized. It may be from a newer version of the app." };
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return { ok: false, error: 'This template file is missing its document data.' };
  }
  return { ok: true, docType: parsed.docType, data: parsed.data };
}
