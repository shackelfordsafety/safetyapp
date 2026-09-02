import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';
import './styles.css';
import './incident/incident.css';
import './voice/voice.css';
import SpeakButton from './voice/SpeakButton';
import CrewSignInKiosk from './jsa/CrewSignInKiosk';
import { emptyIncident, hasMeaningfulIncidentContent, incidentStepProgress, incidentNextStepHint, isIncidentReady, isIncidentPrintFinal, migrateIncidentShape } from './incident/incidentModel';
import { loadIncidentDraft, saveIncidentDraft, clearIncidentDraft, upsertIncidentRecord } from './incident/incidentStorage';
import { deletePhotosForIncident } from './incident/incidentPhotoStorage';
import { incidentCopy } from './incident/incidentCopy';
import IncidentWorkflow from './incident/IncidentWorkflow';
import { IncidentPdfExportRoot, generateIncidentPdf, incidentPdfFingerprint, buildIncidentExportName, getIncidentPdfOverflowFields } from './incident/incidentPdfGenerate';
import { DOCUMENT_REGISTRY, DOCUMENT_CATEGORIES } from './documents/registry';
import { StepNav } from './documents/FormPrimitives';
import { DOCUMENT_STORAGE_KEYS } from './documents/storage';
import { useDraftDocument, saveStatusLabel } from './documents/useDraftDocument';
import { usePdfExport } from './documents/usePdfExport';
import { printedFingerprint } from './documents/printedFingerprint';
import { buildDraftFilename, readFileAsText, parseDraftFileText, downloadTemplateFile, parseTemplateFileText, sanitizeForFilename } from './shared/draftTransfer';
import {
  emptyDisciplinary, hasMeaningfulDisciplinaryContent, isDisciplinaryReady, isDisciplinaryPrintFinal,
  buildDisciplinaryExportName, warningLevelLabel,
  disciplinaryStepProgress, disciplinaryNextStepHint,
} from './documents/disciplinary/disciplinaryModel';
import DisciplinaryWorkflow from './documents/disciplinary/DisciplinaryWorkflow';
import { drawDisciplinaryPdf } from './documents/disciplinary/disciplinaryPdfDraw';
import { drawSeparationPdf } from './documents/separation/separationPdfDraw';
import { drawMedicalEventPdf } from './documents/medicalEvent/medicalEventPdfDraw';
import { drawUncontrolledEventPdf } from './documents/uncontrolledEvent/uncontrolledEventPdfDraw';
import {
  emptyUncontrolledEvent, hasMeaningfulUncontrolledEventContent, isUncontrolledEventReady, isUncontrolledEventPrintFinal,
  buildUncontrolledEventExportName, migrateUncontrolledEventShape,
  uncontrolledEventStepProgress, uncontrolledEventNextStepHint,
} from './documents/uncontrolledEvent/uncontrolledEventModel';
import UncontrolledEventWorkflow from './documents/uncontrolledEvent/UncontrolledEventWorkflow';
import {
  emptyMedicalEvent, hasMeaningfulMedicalEventContent, isMedicalEventReady, isMedicalEventPrintFinal,
  buildMedicalEventExportName,
  medicalEventStepProgress, medicalEventNextStepHint,
} from './documents/medicalEvent/medicalEventModel';
import MedicalEventWorkflow from './documents/medicalEvent/MedicalEventWorkflow';
import {
  emptySeparation, hasMeaningfulSeparationContent, isSeparationReady, isSeparationPrintFinal,
  buildSeparationExportName, migrateSeparationShape,
  separationStepProgress, separationNextStepHint,
} from './documents/separation/separationModel';
import SeparationWorkflow from './documents/separation/SeparationWorkflow';

const DOCUMENT_CATEGORY_ORDER = ['fieldSafety', 'employeeAction'];

/* ── Storage keys ── */
const KEYS = {
  draft: 'sdc.jsa.draft.v4',
  templates: 'sdc.jsa.templates.v1',
  settings: 'sdc.settings.v2',
};

const APP_NAME = 'Safety Documentation Center';
const APP_SUB = 'Field Safety App';
const SHACKELFORD_LOGO = `${import.meta.env.BASE_URL}icons/shackelford-logo.webp`;
const APP_VERSION = '1.0.4-safe-upgrade';
// Fixed at build time by vite.config.js (`define`) — never the visitor's clock.
// Distinct from the draft "last saved" timestamp, which is user-data and browser-time.
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
const BUILD_COMMIT = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : '';

/* ── Helpers ── */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function nowNice(d = new Date()) {
  const v = d instanceof Date ? d : new Date(d);
  return v.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function buildStamp(iso, commit) {
  if (!iso) return '';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Updated ${datePart} · ${timePart}${commit ? ` · ${commit}` : ''}`;
}
function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}
function dateStr(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
function hasText(v) { return Boolean(String(v || '').trim()); }
function splitLines(v) {
  return String(v || '').split(/\n|;/).map(s => s.trim()).filter(Boolean);
}
function normalizeEntry(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function entryTokens(value) {
  const stop = new Set(['a','an','and','as','at','for','from','in','into','of','on','or','the','to','when','where','with']);
  return normalizeEntry(value).split(' ').filter(token => token.length > 2 && !stop.has(token));
}
function isNearDuplicate(a, b) {
  const na = normalizeEntry(a);
  const nb = normalizeEntry(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) >= 12 && (na.includes(nb) || nb.includes(na))) return true;
  const aa = new Set(entryTokens(a));
  const bb = new Set(entryTokens(b));
  if (!aa.size || !bb.size) return false;
  const intersection = [...aa].filter(token => bb.has(token)).length;
  const union = new Set([...aa, ...bb]).size;
  return union > 0 && intersection / union >= 0.82;
}
function mergeUniqueEntries(existingValue, candidates) {
  const existing = splitLines(existingValue);
  const added = [];
  const skipped = [];
  (Array.isArray(candidates) ? candidates : [candidates]).forEach(candidate => {
    const text = String(candidate || '').trim();
    if (!text) return;
    const match = [...existing, ...added].find(item => isNearDuplicate(item, text));
    if (match) skipped.push({ candidate: text, match });
    else added.push(text);
  });
  return {
    value: [...existing, ...added].join('\n'),
    added,
    skipped,
  };
}
/* ── Exact-entry helpers (toggleable suggestions) ──
   Unlike isNearDuplicate (deliberately fuzzy, used to avoid near-duplicate
   clutter when adding), these do exact normalized-line matching only. A
   toggle needs to know precisely what it's adding/removing — fuzzy substring
   matching here could delete an unrelated manually-written sentence that
   merely contains the same word (e.g. removing "Housekeeping" must not
   touch "General housekeeping duties around the yard"). */
function hasExactEntry(existingValue, text) {
  const target = normalizeEntry(text);
  if (!target) return false;
  return splitLines(existingValue).some(line => normalizeEntry(line) === target);
}
function addExactEntry(existingValue, text) {
  const clean = String(text || '').trim();
  if (!clean || hasExactEntry(existingValue, clean)) return { value: existingValue, added: false };
  const lines = splitLines(existingValue);
  lines.push(clean);
  return { value: lines.join('\n'), added: true };
}
function removeExactEntry(existingValue, text) {
  const target = normalizeEntry(text);
  if (!target) return existingValue;
  return splitLines(existingValue).filter(line => normalizeEntry(line) !== target).join('\n');
}
function dedupeList(items) {
  return mergeUniqueEntries('', items).added;
}
function isGenericRow(row) {
  const s = String(row?.step || '').trim().toLowerCase();
  return !s || s === 'daily tasks as discussed during tailgate meeting' || s === 'daily tasks as discussed during the tailgate meeting';
}
function rowsFromSummary(jsa) {
  const steps = splitLines(jsa.dailyTasks);
  const haz = splitLines(jsa.hazardsSummary);
  const con = splitLines(jsa.controlsSummary);
  const n = Math.max(steps.length, haz.length, con.length);
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => ({ step: steps[i] || '', hazards: haz[i] || '', controls: con[i] || '' }));
}
function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => hasText(r.step) || hasText(r.hazards) || hasText(r.controls));
}
function makeRowId() {
  return crypto.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
// Backfills a stable id onto any row that doesn't already have one -- needed
// wherever taskRows can come from data saved before ids existed (an older
// draft or template), so the rendered list's React key is never the row's
// array index (removing an earlier row would otherwise shift every later
// row's index, and React would reuse/reassign the DOM node -- including
// whichever field currently has focus -- to a different row's content).
function withRowIds(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => (r.id ? r : { ...r, id: makeRowId() }));
}
function getContentRows(jsa) {
  const detailed = normalizeRows(jsa.taskRows).filter(row => !isGenericRow(row));
  const summary = rowsFromSummary(jsa);
  if (!detailed.length) return summary;
  const remainingSummary = summary.filter(row => {
    if (!hasText(row.step)) return hasText(row.hazards) || hasText(row.controls);
    return !detailed.some(detail => isNearDuplicate(detail.step, row.step));
  });
  return [...detailed, ...remainingSummary];
}
/* Physical print geometry constants — single source of truth shared by the
   pagination math below and the ?debug=print panel. Must stay in sync with
   the .printSheet / .printPage rules in styles.css's @media print block,
   which declare the exact same numbers.
   Two-level sheet model: @page has no margin of its own — .printSheet is
   the full physical sheet (exactly 8.5in x 11in, zero margin/padding, owns
   the page-break decision), and .printPage fills it (100%/100%) with a
   single padding value (0.3in each side) as the one authoritative inset
   from the physical sheet edge to the JSA form's outer border — nothing
   else in the ancestor chain adds margin or padding. box-sizing is
   explicitly border-box (confirmed by direct Chromium measurement under
   real print-media emulation). PRINT_WIDTH_SAFETY_IN / PRINT_HEIGHT_SAFETY_IN
   below mean "how much of the full sheet is intentionally left unused as a
   buffer against hardware non-printable margins / iOS print quirks this
   repo cannot measure without physical hardware" — the padding itself. */
const PRINT_PAPER_WIDTH_IN = 8.5;
const PRINT_PAPER_HEIGHT_IN = 11;
const PRINT_PAGE_WIDTH_IN = PRINT_PAPER_WIDTH_IN; // .printSheet IS the sheet, .printPage fills it
const PRINT_PAGE_HEIGHT_IN = PRINT_PAPER_HEIGHT_IN;
const PRINT_PAGE_PADDING_IN = 0.3; // every side, uniform — the effective margin, since nothing else in the ancestor chain adds inset
const PRINT_CONTENT_WIDTH_IN = PRINT_PAGE_WIDTH_IN - 2 * PRINT_PAGE_PADDING_IN; // 7.9in
const PRINT_CONTENT_HEIGHT_IN = PRINT_PAGE_HEIGHT_IN - 2 * PRINT_PAGE_PADDING_IN; // 10.4in
const PRINT_WIDTH_SAFETY_IN = 2 * PRINT_PAGE_PADDING_IN;
const PRINT_HEIGHT_SAFETY_IN = 2 * PRINT_PAGE_PADDING_IN;
const PRINT_PX_PER_IN_GEOMETRY = 96; // CSS reference pixel — absolute units resolve
// identically on screen and in print, which is what makes the hidden
// PaginationMeasureRig's screen-mode measurements print-accurate.
const PRINT_CONTENT_HEIGHT_PX = PRINT_CONTENT_HEIGHT_IN * PRINT_PX_PER_IN_GEOMETRY;
// Distance from a .printPage's own top edge (border-box, includes top
// padding) down to the bottom edge of its usable content area — i.e. the
// page's own bottom padding is excluded, top padding is not (because
// measurements below are always taken relative to the page's top edge, so
// top padding is already baked into them by construction).
const PRINT_CONTENT_BOTTOM_PX = (PRINT_PAGE_HEIGHT_IN - PRINT_PAGE_PADDING_IN) * PRINT_PX_PER_IN_GEOMETRY;

// Sign-in sheet: a fixed row height, not a fitted one — see the big comment
// on getSignaturePages for why. A signInPage's chrome (brand header + info
// table + acknowledgement text) measures ~182px, leaving ~831px of real
// usable grid height on an otherwise-empty page (measured directly via
// Playwright against the real rendered DOM, 2026-08-17). 55px still reads as
// a real, legible signature — about 2x the height of the old ~27px/row
// layout that Fonzo confirmed was too small/prone to looking distorted, well
// short of this fix's original 80px — while roughly 44% more signatures fit
// per sign-in page, which is the point: fewer wasted pages on a big crew's
// printed sheet without going back anywhere near the size that broke before
// (Fonzo, 2026-08-17: same legibility bar, smaller box, not a smaller
// signature squeezed into the same box). 13 rows of 55px is 715px,
// comfortably inside 831px with a margin similar to the original 80px/9-row
// choice. --sig-row-h below must be this same number; it exists as a CSS
// custom property (not a hardcoded px in styles.css) so this one constant is
// the only place the number lives.
const SIGNIN_ROW_HEIGHT_PX = 55;
const SIGNIN_ROWS_PER_PAGE = 13; // 26 signature lines/page

function estimateTextLines(value, charsPerLine) {
  const text = String(value || '');
  if (!text.trim()) return 1;
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}
/* FALLBACK ONLY — see PaginationMeasureRig below. These are character-count
   estimates, used only before real measurements are available (first
   render, or if a jsa's measurement hasn't caught up yet); resolvePagePlan()
   prefers a measured plan whenever one exists and only falls back to this.
   Chars-per-line derived from the printed task table's actual column widths
   (see .documentPage .printTaskTable th:nth-child(1/2/3) in styles.css:
   31% / 32% / 37% of PRINT_CONTENT_WIDTH_IN, minus ~4.5px cell padding each
   side, at the table's 9.8px Arial print font). Average glyph width for
   Arial body text is roughly 0.55x the font size, so: usable column width /
   (0.55 * 9.8px), rounded down for a safety margin against Safari rendering
   slightly wider than Chromium/desktop font metrics. */
function estimateRowUnits(row) {
  return Math.max(
    estimateTextLines(row.step, 36),
    estimateTextLines(row.hazards, 37),
    estimateTextLines(row.controls, 43),
    1,
  );
}
/* FALLBACK ONLY (see note above estimateRowUnits). Job Info / Meeting Info
   fields printed above the task table are free text and can grow well past
   one line — every wrapped line directly shrinks the space left for the
   task table on the Main JSA page. 56 chars/line approximates that table's
   usable label+value row width at 8.8px. */
function estimateUpperSectionLines(jsa) {
  return estimateTextLines(jsa.assignedMentorSse, 56)
    + estimateTextLines(jsa.tailgateTopic, 56)
    + estimateTextLines(jsa.previousDaySafety, 56)
    + estimateTextLines(jsa.overallWorkTask, 56);
}
/* FALLBACK ONLY (see note above estimateRowUnits) — a conservative estimate
   used only until PaginationMeasureRig's real measurements are available.
   BASELINE_UPPER_LINES is what this budget already assumes for the 4 upper
   rows (~1 line each); every additional wrapped line beyond that comes
   straight out of the task-table budget one-for-one. */
function mainRowCapacity(jsa) {
  const BASELINE = 18;
  const BASELINE_UPPER_LINES = 4;
  const MIN_CAPACITY = 7;
  const extraUpperLines = Math.max(0, estimateUpperSectionLines(jsa) - BASELINE_UPPER_LINES);
  return Math.max(MIN_CAPACITY, BASELINE - extraUpperLines);
}
// FALLBACK ONLY (see note above estimateRowUnits). Continuation pages have a
// small, near-fixed header, so capacity doesn't need to shrink dynamically.
function continuationRowCapacity() { return 26; }
function paginateRowsByUnits(rows, capacity) {
  const pages = [];
  let current = [];
  let used = 0;
  let oversized = false;
  rows.forEach(row => {
    const units = estimateRowUnits(row);
    if (units > capacity) oversized = true;
    if (current.length && used + units > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += units;
  });
  if (current.length) pages.push(current);
  return { pages, oversized };
}
function fillRows(rows, minCount) {
  return [...rows, ...Array.from({ length: Math.max(0, minCount - rows.length) }, () => ({ step: '', hazards: '', controls: '' }))];
}
function paginateTaskContent(jsa) {
  const rows = getContentRows(jsa);
  const mainCapacity = mainRowCapacity(jsa);
  let mainRows = [];
  let mainUsed = 0;
  let cutAt = rows.length;
  let oversized = false;

  for (let i = 0; i < rows.length; i += 1) {
    const units = estimateRowUnits(rows[i]);
    if (units > continuationRowCapacity()) oversized = true;
    if (mainRows.length && mainUsed + units > mainCapacity) { cutAt = i; break; }
    if (!mainRows.length && units > mainCapacity) { cutAt = 0; break; }
    mainRows.push(rows[i]);
    mainUsed += units;
  }

  const remaining = rows.slice(cutAt);
  const paged = paginateRowsByUnits(remaining, continuationRowCapacity());
  oversized = oversized || paged.oversized;
  // Pad with blank rows for a visually filled page, but never past this JSA's
  // own actual capacity — padding used to reference a hardcoded 22 regardless
  // of the dynamic capacity above, which could over-fill a page whose capacity
  // had shrunk for long upper-section content.
  const mainMinRows = Math.max(Math.min(16, mainCapacity), Math.min(mainCapacity, mainRows.length + 4));
  return {
    contentRows: rows,
    mainContentRows: mainRows,
    mainRows: fillRows(mainRows, mainMinRows),
    continuationPages: paged.pages.map(page => fillRows(page, 10)),
    oversized,
    mainCapacity,
    mainUsed,
  };
}
// Once the crew kiosk has captured digital signatures, the printed sheet
// leads with those (numbered, filled in with the actual signature image --
// "printer ink"), then signatureLineCount blank lines after them for anyone
// who signs in person later ("pen ink"). Before any kiosk signatures exist,
// signatureLineCount means what it always has: the sheet's total blank line
// count -- unchanged, so existing JSAs that never touch the kiosk print
// exactly as before. Deliberately uncapped by signatureLineCount's own
// 1-100 UI clamp: every real captured signature must appear on the printed
// record, never silently truncated (see CLAUDE.md's data-integrity
// priority) -- only the manually-typed "extra blank lines" count is capped.
// Shared by getSignaturePages and MainJsaDocumentPage's own "generated for
// N signatures" note, so the two can't drift apart.
function signInLineTotal(jsa) {
  const crew = Array.isArray(jsa.crewSignatures) ? jsa.crewSignatures : [];
  const extraBlank = Math.max(1, Math.min(100, Number(jsa.signatureLineCount) || 1));
  return crew.length > 0 ? crew.length + extraBlank : extraBlank;
}
// Fixed, not fitted to whatever's left over: SIGNIN_ROW_HEIGHT_PX (defined
// near the print geometry constants above) is a real, generous, known box a
// signature always gets, the same way a pre-printed paper sign-in sheet has
// a fixed number of ruled lines per page -- not "however many lines happen
// to fit today, shrunk to squeeze them all on one page." A big crew simply
// gets more sign-in pages instead of smaller signatures. This directly
// replaced a variable-row-height layout (CSS Grid `fr` tracks) that could
// only be sized correctly at the moment a page happened to be captured --
// three targeted fixes at that layer all worked in this repo's own tests
// and still came out wrong in real generated PDFs (Fonzo, 2026-08-17).
// Fixed-size boxes need no runtime fitting at all, which is the actual
// point: nothing left to get wrong between "looks right in a test" and
// "looks right in the field."
function getSignaturePages(jsa) {
  const crew = Array.isArray(jsa.crewSignatures) ? jsa.crewSignatures : [];
  const total = signInLineTotal(jsa);
  const maxPerPage = SIGNIN_ROWS_PER_PAGE * 2;
  const pageCount = Math.ceil(total / maxPerPage);
  const pages = [];
  let next = 1;
  for (let i = 0; i < pageCount; i += 1) {
    const size = Math.min(maxPerPage, total - next + 1);
    pages.push(Array.from({ length: size }, () => {
      const n = next++;
      const signed = crew[n - 1];
      return signed ? { n, dataUrl: signed.dataUrl } : { n };
    }));
  }
  return pages;
}
// Heuristic-only plan (character-count estimates). This is the fallback
// used before real measurements are available (see PaginationMeasureRig
// below) — kept as a standalone, pure function so anything that genuinely
// only needs a quick estimate (or runs before the rig has mounted) still
// works exactly as before.
function getPagePlan(jsa) {
  const taskPlan = paginateTaskContent(jsa);
  const signInPages = getSignaturePages(jsa);
  return {
    ...taskPlan,
    signInPages,
    totalPages: 1 + taskPlan.continuationPages.length + signInPages.length,
  };
}
// A fingerprint of everything that could affect pagination height: row
// content and every fixed-section field. Used to detect whether a
// PaginationMeasureRig measurement still corresponds to the jsa's current
// content, or is stale from before the latest edit (in which case
// buildMeasuredPlan falls back to the heuristic until the rig catches up).
function fingerprintPaginationInput(jsa) {
  const rows = getContentRows(jsa);
  return JSON.stringify([
    rows.map(r => [r.step, r.hazards, r.controls]),
    jsa.assignedMentorSse, jsa.tailgateTopic, jsa.previousDaySafety, jsa.overallWorkTask,
    jsa.location, jsa.jobSite, jsa.timeIssued, jsa.timeExpired, jsa.date, jsa.jobNumber,
    jsa.superintendentForeman, jsa.emergencyPhone, jsa.client, jsa.nearestMedicalFacility,
    jsa.siteContactPhone, jsa.musterPoint, jsa.acknowledgement, jsa.signatureLineCount,
    // crewSignatures only ever grows by append (see CrewSignInKiosk.jsx), so
    // length alone fully captures "did the sign-in sheet's content change" --
    // stringifying the actual dataUrls would be expensive for no benefit.
    jsa.crewSignatures?.length || 0,
  ]);
}
/* Real rendered-height pagination — the packing algorithm is the same
   greedy "add while it still fits" shape as paginateTaskContent above, but
   walks REAL measured pixel heights (from PaginationMeasureRig) instead of
   estimated text-wrap "units". Blank filler rows are intentionally not part
   of this at all — they're appended afterward (fillRows), exactly as
   before, so they can never count toward capacity or trigger a
   continuation page. Returns null (caller falls back to the heuristic
   getPagePlan) whenever measurements don't exist yet or are stale for this
   exact jsa content — see fingerprintPaginationInput. */
function buildMeasuredPlan(jsa, measurements) {
  const rows = getContentRows(jsa);
  if (!rows.length) return null; // trivial case; heuristic already handles this identically
  if (!measurements) return null;
  if (measurements.fingerprint !== fingerprintPaginationInput(jsa)) return null;
  if (!measurements.rowHeightsPx || measurements.rowHeightsPx.length !== rows.length) return null;
  if (!measurements.continuationRowHeightsPx || measurements.continuationRowHeightsPx.length !== rows.length) return null;
  if (measurements.mainFirstRowOffsetPx == null || measurements.continuationFirstRowOffsetPx == null) return null;

  const mainAvailablePx = PRINT_CONTENT_BOTTOM_PX
    - measurements.mainFirstRowOffsetPx
    - measurements.mainFooterHeightPx
    - measurements.continuationFlagHeightPx; // always reserved — see PaginationMeasureRig comment
  const continuationAvailablePx = PRINT_CONTENT_BOTTOM_PX
    - measurements.continuationFirstRowOffsetPx
    - measurements.continuationFooterHeightPx;

  // Main-page packing uses rowHeightsPx (rows measured at the main table's
  // own 24px floor); continuation packing below uses continuationRowHeightsPx
  // instead (rows measured at the continuation table's taller 35px floor) —
  // these are NOT interchangeable, see the PaginationMeasureRig comment.
  let mainRows = [];
  let mainUsed = 0;
  let cutAt = rows.length;
  let oversized = false;
  for (let i = 0; i < rows.length; i += 1) {
    const h = measurements.rowHeightsPx[i];
    if (measurements.continuationRowHeightsPx[i] > continuationAvailablePx) oversized = true;
    if (mainRows.length && mainUsed + h > mainAvailablePx) { cutAt = i; break; }
    if (!mainRows.length && h > mainAvailablePx) { cutAt = 0; break; }
    mainRows.push(rows[i]);
    mainUsed += h;
  }

  const remaining = rows.slice(cutAt);
  const remainingHeights = measurements.continuationRowHeightsPx.slice(cutAt);
  const continuationPagesRaw = [];
  let curPage = [];
  let curUsed = 0;
  remaining.forEach((row, idx) => {
    const h = remainingHeights[idx];
    if (curPage.length && curUsed + h > continuationAvailablePx) {
      continuationPagesRaw.push({ rows: curPage, usedPx: curUsed });
      curPage = [];
      curUsed = 0;
    }
    curPage.push(row);
    curUsed += h;
  });
  if (curPage.length) continuationPagesRaw.push({ rows: curPage, usedPx: curUsed });

  // Filler/blank rows are real <tr> elements too -- they physically consume
  // space on the page even though they never influence *which* rows are
  // real content vs. overflow (that decision is already final above). A
  // fixed count here (previously "+4 up to 16") was confirmed by direct
  // measurement to overflow the page when a nearly-full main page had only
  // a couple px of headroom left: adding 4 more 24px rows regardless added
  // ~90px of real content the capacity check never saw. Filler height uses
  // the same per-table floor as real rows (24px main / 35px continuation —
  // must match .printTaskTable td / .continuationTaskTable td in
  // styles.css) so the cap is exact, not a guess.
  const MAIN_ROW_FLOOR_PX = 24;
  const CONTINUATION_ROW_FLOOR_PX = 35;
  const mainFillerCap = Math.floor(Math.max(0, mainAvailablePx - mainUsed) / MAIN_ROW_FLOOR_PX);
  const mainMinRows = mainRows.length + Math.max(0, Math.min(4, mainFillerCap));
  return {
    contentRows: rows,
    mainContentRows: mainRows,
    mainRows: fillRows(mainRows, mainMinRows),
    continuationPages: continuationPagesRaw.map(({ rows: page, usedPx }) => {
      const fillerCap = Math.floor(Math.max(0, continuationAvailablePx - usedPx) / CONTINUATION_ROW_FLOOR_PX);
      return fillRows(page, page.length + Math.max(0, Math.min(10, fillerCap)));
    }),
    oversized,
    mainCapacity: Math.round(mainAvailablePx),
    mainUsed: Math.round(mainUsed),
    measured: true,
  };
}
// The single entry point every consumer should use: prefers a real measured
// plan, falls back to the character-count heuristic only when measurements
// aren't available yet (first render) or are momentarily stale (rig hasn't
// caught up to the latest edit) — per the requirement that estimates remain
// only an initial fallback, never the final pagination authority.
function resolvePagePlan(jsa, measurements) {
  const taskPlan = buildMeasuredPlan(jsa, measurements) || paginateTaskContent(jsa);
  const signInPages = getSignaturePages(jsa);
  return {
    ...taskPlan,
    signInPages,
    totalPages: 1 + taskPlan.continuationPages.length + signInPages.length,
  };
}
function calcFitFromPlan(plan) {
  if (plan.oversized) {
    return {
      status: 'bad',
      label: 'Content needs review',
      message: 'At least one task row is too large to fit cleanly on a continuation page. Shorten that row or divide it into smaller task rows.',
    };
  }
  if (plan.continuationPages.length) {
    return {
      status: 'warn',
      label: 'Continuation sheet required',
      message: `${plan.continuationPages.length} JSA continuation page${plan.continuationPages.length === 1 ? '' : 's'} will be generated. Complete rows will move together and will not be split between pages.`,
    };
  }
  if (plan.mainUsed >= plan.mainCapacity * 0.82) {
    return { status: 'warn', label: 'Close to full', message: 'The main JSA fits on one page but is close to its clean layout limit.' };
  }
  return { status: 'good', label: 'Fits on main JSA', message: 'The main JSA fits cleanly on one standard letter page.' };
}
function calcFit(jsa, measurements) {
  return calcFitFromPlan(resolvePagePlan(jsa, measurements));
}
function buildExportName(jsa) {
  const raw = [jsa.jobSite || jsa.location || 'Shackelford', 'JSA', jsa.date || todayISO()].join('_');
  return raw.replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/* ── Empty JSA ── */
function emptyJsa() {
  return {
    id: crypto.randomUUID?.() || String(Date.now()),
    status: 'draft',
    templateName: '',
    location: '',
    jobSite: '',
    jobNumber: '',
    date: todayISO(),
    timeIssued: '',
    timeExpired: '',
    superintendentForeman: '',
    emergencyPhone: '',
    client: '',
    nearestMedicalFacility: '',
    siteContactPhone: '',
    musterPoint: '',
    assignedMentorSse: '',
    acknowledgement: 'I have reviewed and understand the conditions of this JSA and its attached plans and will comply. I will report hazardous conditions or acts identified on this job site to my supervisor and/or Shackelford representative so they can be corrected if necessary. I will conduct a last minute risk assessment before each task and will exercise stop work authority for any unsafe act, condition, or hazard.',
    tailgateTopic: '',
    previousDaySafety: 'None reported.',
    overallWorkTask: '',
    dailyTasks: '',
    hazardsSummary: '',
    controlsSummary: '',
    taskRows: [],
    // Lightweight interaction metadata only (not a second document copy): which
    // task suggestion introduced which hazard/control entries, so a bundle can be
    // safely reversed later. Additive field — older saved drafts/templates without
    // it are handled by the existing `{ ...emptyJsa(), ...raw }` merge pattern.
    suggestionBundles: [],
    signatureLineCount: 30,
    // Explicit choice, not inferred from whether the kiosk happens to have
    // been touched (that was the 2026-08-31 first pass -- confusing in the
    // field because the picker silently vanished once someone signed, with
    // no visible switch to explain why). 'kiosk' | 'printout'.
    signInMode: 'kiosk',
    // Digitally-captured crew sign-in (kiosk mode) -- [{ dataUrl, signedAt }],
    // app-generated timestamp, never typed. Day-specific like date/tailgate
    // topic below: always reset to empty on a new day / saved template, never
    // carried forward. Distinct from signatureLineCount, which only ever
    // controlled how many blank lines print for pen signing.
    crewSignatures: [],
    notes: '',
    lastSavedAt: '',
  };
}

const BUILT_IN_TEMPLATES = [{
  id: 'blank-jsa',
  source: 'built-in',
  name: 'Blank JSA',
  description: 'Start from a clean form. Save recurring information as your own custom template.',
  data: emptyJsa(),
}];

function makeTodayFromTemplate(data) {
  return { ...emptyJsa(), ...data, id: crypto.randomUUID?.() || String(Date.now()), status: 'draft', date: todayISO(), timeIssued: '', timeExpired: '', tailgateTopic: '', previousDaySafety: 'None reported.', signatureLineCount: Number(data?.signatureLineCount) || 30, signInMode: 'kiosk', crewSignatures: [], notes: '', lastSavedAt: '', taskRows: withRowIds(data?.taskRows) };
}
function templatePayload(jsa, name) {
  return {
    id: crypto.randomUUID?.() || String(Date.now()),
    source: 'custom',
    name,
    description: 'Custom saved JSA template',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: { ...jsa, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), source: 'custom', status: 'template', templateName: name, date: '', timeIssued: '', timeExpired: '', tailgateTopic: '', previousDaySafety: 'None reported.', signatureLineCount: Number(jsa.signatureLineCount) || 30, signInMode: 'kiosk', crewSignatures: [], notes: '', lastSavedAt: '' },
  };
}

/* ── Quick-add libraries ── */
const TAILGATE_GROUPS = [
  { title: 'Core Safety', items: ['Hazard recognition','Incident reporting','Stop work authority','Last minute risk assessment','PPE compliance','Housekeeping','Communication before task start','Good catch / near miss awareness'] },
  { title: 'Equipment / Traffic', items: ['Line of fire','Backing equipment','Equipment blind spots','Spotter awareness','Speeding','Material delivery traffic','No phones/earbuds while operating','Seat belt use','Safe equipment access/egress'] },
  { title: 'Civil / Earthwork', items: ['Ground conditions','Grading and compacting','Excavation awareness','Soil stabilization','Dust control','Material placement','Slope and soft ground awareness','Underground/overhead utility awareness'] },
  { title: 'Weather / Health', items: ['Heat stress / hydration','Cold stress','Severe weather awareness','Lightning safety','Fatigue awareness','Silica/dust exposure','Wildlife/insect awareness'] },
  { title: 'Rail / Industrial', items: ['Railroad right-of-way awareness','Rail clearance','Restricted area control','Utility corridor work','Public/third-party traffic','Industrial vehicle traffic'] },
  { title: 'Administrative', items: ['Review of site rules','Emergency procedures and muster point','Reporting injuries immediately','Worker acknowledgement and stop work authority','Review of previous day observations'] },
];
const PREV_DAY_GROUPS = [
  { title: 'No Issues', items: ['None reported.','No injuries or near misses reported previous day.','No safety concerns reported from previous shift.'] },
  { title: 'Review / Coaching', items: ['Reviewed previous day observations with crew.','Near miss reviewed with crew before starting work.','Reviewed incident reporting expectations with crew.','Reviewed housekeeping and access concerns with crew.'] },
  { title: 'Common Follow-Up', items: ['Housekeeping concern corrected previous day.','Equipment/traffic concern reviewed with supervision.','No phones/earbuds while operating equipment.','Failure to communicate injury the day prior.','Heat exposure concern reviewed with crew.'] },
];
const OVERALL_TASK_GROUPS = [
  { title: 'General', items: ['General site work','Site preparation','Site maintenance','Equipment support operations','Access road preparation','Material handling and placement'] },
  { title: 'Civil / Earthwork', items: ['Mass grading','Earthwork operations','Excavation operations','Rough grading','Fine grading','Roadway / access preparation','Drainage / undercut work','Backfill and compaction operations'] },
  { title: 'Stabilization / Materials', items: ['Lime stabilization','Cement stabilization','Rock placement','Stone placement','Place and compact stone','Material delivery and hauling','Concrete placement support'] },
  { title: 'Rail / Industrial', items: ['Railroad support work','Right-of-way support','Industrial site support','Utility corridor work','Track area access support'] },
];
const DAILY_TASK_GROUPS = [
  { title: 'General Site Work', items: ['Site inspection','Housekeeping','Install/maintain barricades','Site mobilization','Site demobilization','Install signage','Material handling','Equipment setup'] },
  { title: 'Site Prep / Clearing', items: ['Mark work limits','Mark overhead and underground utilities','Clearing and grubbing','Mulching','Tree and vegetation removal','Demolish existing structures','Remove existing fence','Debris removal','Survey and staking'] },
  { title: 'Earthwork / Grading', items: ['Mass grading','Rough grading','Fine grading','Finish grading','Strip topsoil','Work in undercut','Backfill','Grade and compact','Compact soil','Proof roll','Dress slopes','GPS grading','Fine tune grade','Water for dust control'] },
  { title: 'Excavation / Drainage', items: ['Excavation','Trenching','Install storm drain','Install pipe','Unload pipe and structures','Install culvert','Install drainage structure','Dewatering','Install riprap','Install erosion control','Maintain erosion control'] },
  { title: 'Soil Stabilization', items: ['Lime delivery','Spread lime','Mix lime into soil','Stabilize soil','Cement stabilization','Moisture conditioning','Prepare stabilized subgrade'] },
  { title: 'Material Delivery / Hauling', items: ['Rock delivery','Stone delivery','Haul dirt','Haul material','Place rock','Place fill','Place topsoil','Place aggregate','Manage stockpiles','Stage trucks','Unload delivered material'] },
  { title: 'Equipment Operations', items: ['Operate heavy equipment','Operate dozer','Operate excavator','Operate loader','Operate roller or compactor','Operate motor grader','Operate dump truck','Operate water truck','Back and maneuver equipment','Spot equipment','Move equipment','Load equipment','Unload equipment','Transport equipment','Fuel equipment','Service equipment'] },
  { title: 'Concrete / Stone', items: ['Place and compact stone','Place stone','Concrete placement','Install formwork','Handle rebar and materials','Install stabilized construction entrance','Install track-out device'] },
  { title: 'Rail / Right-of-Way', items: ['Railroad work','Access rail work area','Work near active rail','Work in siding/spur','Place ballast or stone','Railroad flagging'] },
];
const HAZARD_GROUPS = [
  { title: 'People / Line of Fire', items: ['Line of fire','Struck-by exposure','Caught-between exposure','Pinch points','Workers on foot near equipment','Equipment blind spots','Swing radius','Backing equipment','Falling objects','Suspended loads'] },
  { title: 'Equipment / Traffic', items: ['Moving equipment','Equipment traffic','Rollover/runover potential','Limited visibility','Equipment failure','Rotating equipment','Noise and vibration','Unsafe speeds','Unsecured loads'] },
  { title: 'Ground Conditions', items: ['Slips, trips, and falls','Uneven ground','Soft or unstable ground','Muddy or slippery ground','Steep slopes','Drop-offs','Open excavation','Unstable subgrade','Poor access/egress'] },
  { title: 'Excavation / Utilities', items: ['Trench/excavation exposure','Cave-in potential','Spoil pile instability','Water accumulation','Overhead power lines','Underground utilities','Utility strike potential','Electrical shock/electrocution'] },
  { title: 'Weather / Environmental', items: ['Heat stress','Cold stress','Lightning','High winds','Dust exposure','Reduced visibility','Wet conditions','Erosion/sediment runoff','Wildlife/insects','Poison ivy/oak'] },
  { title: 'Chemical / Dust', items: ['Lime exposure','Cement dust','Silica dust','Fuel/oil exposure','Chemical splash','Inhalation exposure','Eye/skin irritation','Flammable vapors'] },
  { title: 'Traffic / Public', items: ['Public traffic','Delivery truck traffic','Haul road traffic','Roadway traffic exposure','Unauthorized vehicle entry','Pedestrian/public access','Congested access points','Third-party traffic'] },
  { title: 'Rail / Industrial', items: ['Active rail movement','Rail clearance','Industrial vehicle traffic','Plant/site traffic','Restricted area exposure','Loss of communication'] },
];
const CONTROL_GROUPS = [
  { title: 'Communication / Spotters', items: ['Use a spotter','Maintain eye contact with operator','Use radios or hand signals','Confirm communication before movement','Review work plan before starting','Maintain communication with operators and supervision'] },
  { title: 'Equipment Controls', items: ['Maintain safe distance from equipment','Stay clear of swing radius and blind spots','Inspect tools and equipment','Verify horn, lights, and backup alarm','Operate at safe speed','Wear seat belt','Use mirrors and cameras','Park on level ground before servicing','Lower attachments before servicing'] },
  { title: 'PPE', items: ['Wear high-visibility clothing','Wear safety glasses','Wear gloves','Wear hard hat','Use hearing protection','Use respiratory protection when required','Wear proper work boots','Wear required PPE'] },
  { title: 'Excavation / Utilities', items: ['Locate and verify utilities','Maintain current one-call tickets','Mark utilities','Maintain power line clearance','Keep spoil piles back','Provide safe access/egress','Barricade open excavations','Use required protective system','Inspect excavation before entry'] },
  { title: 'Traffic / Access', items: ['Establish traffic control','Use cones, barricades, and signs','Keep access roads clear','Stage trucks in designated area','Control delivery traffic','Separate workers from public','Use designated haul routes','Coordinate deliveries with supervision'] },
  { title: 'Weather / Heat', items: ['Hydrate regularly','Take heat breaks as needed','Monitor for heat stress','Provide shade/rest area','Stop work for lightning per site policy','Adjust work for severe weather','Control dust','Apply water for dust control'] },
  { title: 'Housekeeping / Site', items: ['Keep walkways clear','Remove trip hazards','Maintain clean access/egress','Secure loose materials','Correct housekeeping issues','Keep tools/materials organized','Maintain stable work surfaces'] },
  { title: 'Rail / Industrial', items: ['Follow railroad safety requirements','Maintain rail clearance','Coordinate with flagger/railroad representative','Stay out of restricted areas unless authorized','Maintain communication with site operations','Follow site access controls'] },
  { title: 'Stop Work / LMRA', items: ['Complete LMRA before each task','Use stop work authority','Report hazards immediately','Review emergency procedures and muster point','Stop and reassess when conditions change'] },
];

const TASK_ROW_GROUPS = [
  { title: 'Site Prep', items: [
    { label: 'Marking boundaries / LODs', step: 'Marking boundaries / limits of disturbance', hazards: 'Slips, trips and falls; cold, heat and wet weather; bee/snake stings and bites; skin irritation (poison oak/ivy); struck-by / pinch points; overhead/underground utilities', controls: 'Proper clothing and PPE for task; stay hydrated; no work in heavy rain or lightning; take breaks during high/low temps; mark overhead power lines with flagging and signage; stay clear of moving equipment; maintain minimum 15 ft clearance from overhead power lines; use spotter when working near overhead power lines' },
    { label: 'Marking overhead/underground utilities', step: 'Marking overhead/underground utilities', hazards: 'Unintended contact with underground/overhead utilities; electrocution from overhead power lines; struck-by hazards; slips, trips and falls; burns; cuts; struck by equipment', controls: 'Maintain current one calls; mark underground utilities with flagging; take pictures of marked area; verify depth and location; wear required PPE; establish communication with operator; use spotter when working near overhead power lines; stay hydrated' },
    { label: 'Installing barricades and signs', step: 'Installing barricades and signs', hazards: 'Slips, trips and falls; cuts; heat, cold and wet hazards; hand injuries', controls: 'Housekeeping; watch your step in soft/slick ground; wear required PPE; use proper lifting; use proper tool for task' },
  ]},
  { title: 'Erosion Control', items: [
    { label: 'Installing erosion control', step: 'Installing erosion control measures', hazards: 'Slips, trips and falls; muscle skeletal injuries; cuts; crush, pinch point and puncture hazards; runover/rollover; electrical hazards (overhead/underground utilities)', controls: 'Maintain 3 points of contact; good housekeeping; use proper lifting technique; wear required PPE; stay clear of moving equipment (at least 100 ft); mark overhead power lines with flagging and signage; use spotter when working near overhead power lines; maintain current one calls' },
    { label: 'Maintaining erosion control', step: 'Maintaining erosion control measures', hazards: 'Slips, trips and falls; impalement hazards; cuts; muscle skeletal injuries; crush, pinch point, puncture hazards', controls: 'Good housekeeping; watch your step on soft/slick soil; wear required PPE; use proper lifting technique; install protection caps on all puncture hazards' },
    { label: 'Removing erosion control', step: 'Removing erosion control', hazards: 'Slips, trips and falls; muscle skeletal injuries; cuts; crush, pinch point and puncture hazards; runover by equipment; electrical hazards', controls: 'Maintain 3 points of contact; good housekeeping; use proper lifting technique; wear required PPE; stay clear of moving equipment; mark overhead power lines; use spotter when working near utilities' },
  ]},
  { title: 'Clearing and Grubbing', items: [
    { label: 'Clearing and grubbing', step: 'Clearing and grubbing', hazards: 'Slips, trips and falls; heat/cold and wet conditions; environmental hazards; cuts; burns; impalement hazards; electrocution from overhead power lines or underground utilities; rollover, runover and struck-by hazards', controls: 'Maintain 3 points of contact; good housekeeping; watch your step in soft/slick ground; stay hydrated; take breaks; wear required PPE; protect or remove impalement hazards; use spotter when working near utilities; flag all utilities in the work area; maintain current one calls; maintain minimum 10 ft clearance from overhead power lines; wear seatbelt; keep safe distance from moving equipment' },
    { label: 'Mulching', step: 'Mulching', hazards: 'Rollover, runover and amputation hazards; slips, trips and falls; heat/cold and wet conditions; environmental hazards; cuts; burns; impalement hazards; electrical hazards from overhead power lines or underground utilities; flying debris', controls: 'Be careful on slopes/unstable ground; wear seatbelt; keep safe distance from moving equipment; make sure horn, lights and back-up alarm work; make eye contact with operator before approaching; keep body parts out of point of operation; LOTO equipment to clear jammed material; barricade and keep unauthorized personnel out of the area; maintain 3 points of contact; good housekeeping; wear required PPE' },
  ]},
  { title: 'Grading and Compacting', items: [
    { label: 'Grading and compacting', step: 'Grading and compacting', hazards: 'Slips, trips and falls when mounting equipment; back and muscle injuries; cuts; sprains/strains; struck-by; pinch points; crush; rollover, runover injuries; fires/burns; heat/cold and wet conditions; electrical hazards (underground/overhead power lines); equipment failure', controls: 'Maintain 3 points of contact; good housekeeping; watch footing in soft or slick ground conditions; use proper lifting techniques; wear proper PPE; wear seatbelt; be careful on slopes or unstable ground; stay clear of moving equipment; make eye contact with operator before you approach; have fire extinguisher in equipment and work area; stay hydrated; take breaks; mark all underground utilities and overhead power lines; stay 15 ft away from overhead power lines; maintain current one calls; verify horn, lights, back-up alarm and emergency stop work properly' },
  ]},
  { title: 'Excavation / Drainage', items: [
    { label: 'Unloading pipe and structures', step: 'Unloading pipe and structures', hazards: 'Cuts; eye/face injuries; crush; pinch points; slips, trips and falls; falling objects; struck-by; runovers; rollover; electrical hazards; equipment failure', controls: 'Wear required PPE; stay clear from moving equipment; do not stand or work under suspended loads; inspect the lifting equipment; review JSA with the crew; stay a safe distance from equipment and suspended loads; establish eye contact with operator before approaching; use spotter when working near underground/overhead power lines' },
    { label: 'Installing pipe', step: 'Installing pipe', hazards: 'Slips, trips and falls; cuts; crush; struck-by; pinch points; eye/face injuries; muscle skeletal injuries; electrical and underground utilities; heat/cold and wet conditions; runover/rollover; caught between; atmospheric hazards; falling objects; equipment failures', controls: 'Watch your step in wet/slick ground; wear required PPE; stay clear of moving equipment; use proper lifting techniques; keep one calls current; barricade work area; stay 15 ft from power lines; verify depth and location; stay hydrated; take breaks; wear seatbelt; do not stand or walk under suspended loads; inspect all equipment at the beginning of the shift' },
  ]},
  { title: 'Soil Stabilization', items: [
    { label: 'Lime or cement stabilization of soil', step: 'Lime or cement stabilization of soil', hazards: 'Slips, trips and falls from equipment; pinch points; struck-by; rollover; runover; respiratory (silica) and electrical hazards (overhead power lines/underground utilities); high noise levels', controls: 'Maintain 3 points of contact; good housekeeping; watch footing in soft, slick or wet ground; stay clear of moving equipment; make sure horn, lights and back-up alarm are working; wear required PPE; wear seatbelt; be careful on slopes or unstable ground; wet down work area as needed; wear required silica PPE; stay 15 ft from overhead power lines; use spotter when working near overhead power lines/utilities; mark all utilities with flagging/paint; stay away from high noise areas; wear required hearing protection' },
  ]},
  { title: 'Place and Compact Stone', items: [
    { label: 'Place and compact stone', step: 'Place and compact stone', hazards: 'Slips, trips and falls; cuts; eye/face injuries; muscle skeletal and ergonomic injuries; sprains/strains; silica dust; flying objects; runover; rollover hazards; pinch points; struck-by hazards', controls: 'Watch footing in soft or slick ground conditions; good housekeeping; wear required PPE; use proper lifting technique; wet down when silica dust is present; mark overhead power lines/underground utilities; use spotter when working near overhead or underground utilities; keep safe distance from moving equipment; make sure horn, lights and back-up alarm are working; barricade work area; wear seatbelt; make eye contact with operator before approaching' },
  ]},
  { title: 'Equipment Operations', items: [
    { label: 'Servicing equipment', step: 'Servicing equipment', hazards: 'Slips, trips and falls mounting equipment; pinch points; cuts; burns; crush; fire and chemical hazards; struck-by; back and crush injuries; electrical shock; high levels of noise; heat and cold injuries', controls: 'Maintain 3 points of contact; watch footing and maintain good housekeeping; use proper LOTO procedures; verify guards/shields are properly re-installed; avoid pinch points; use proper lifting techniques; review SDS sheets for chemicals used; have tagged/charged fire extinguisher; perform work in area free of overhead power lines; watch hand placement; make eye contact with operator before approaching; wear seat belt; park all equipment on level ground; place in park, lower boom, forks and blades' },
    { label: 'Fueling equipment', step: 'Fueling equipment', hazards: 'Fire, explosion and chemical hazards; eye/face injuries; electrical hazards; slips, trips and falls; burns; cuts; crush and pinch point hazards; environmental contamination', controls: 'Maintain good housekeeping; wear required PPE; inspect all tools and equipment in use; watch footing; maintain 3 points of contact; avoid pinch points; turn off engine and do not overfill equipment; no smoking or use of cell phone during refueling' },
    { label: 'Material delivery / truck traffic', step: 'Material delivery / haul trucks entering and exiting work area', hazards: 'Struck-by hazards; line of fire; backing equipment; material delivery traffic; public/third-party traffic', controls: 'Use spotters where required; maintain communication with operators and foremen; maintain safe distance from equipment; keep access/egress clear; wear required PPE/high-visibility clothing' },
    { label: 'Mass grading / equipment operations', step: 'Mass grading and heavy equipment operations in assigned work area', hazards: 'Heavy equipment movement; line of fire; caught-between hazards; uneven ground; dust exposure; noise/vibration', controls: 'Stay clear of swing radius and blind spots; maintain safe distance from equipment; control dust as needed; verify stable ground before equipment/material placement; use stop work authority for unsafe acts/conditions' },
  ]},
  { title: 'Site Mobilization', items: [
    { label: 'Equipment loading and transport', step: 'Equipment loading, transport, and mobilization/demobilization', hazards: 'Traffic; struck-by; collision; crush; cuts/pinch point hazards; overhead power lines; flying objects; equipment rollovers; caught-between hazards; equipment blind spots; muscle skeletal injuries; falling objects; unsecured loads', controls: 'Use 3 points of contact; good housekeeping; watch your step while climbing on trailer and walking on rough terrain; wear required PPE; stay minimum 15 ft from overhead power lines; make eye contact with operator before approaching; keep a safe distance from moving equipment; inspect all equipment (horn, lights, back-up alarm and emergency stop); wear seat belts; avoid pinch points; keep body parts out of line of fire; be careful on slopes or unstable ground' },
    { label: 'Driving to/from field', step: 'Driving to and from the field', hazards: 'Motor vehicle accident; distracted driving; fatigue', controls: 'Wear seatbelt; obey speed limit; no cell phone while driving; obey all traffic laws; reduce speed for inclement weather; increase stopping distance with heavy trailer; stay alert and do not drive fatigued' },
  ]},
];


const TASK_SUGGESTIONS = {
  [normalizeEntry('Site inspection')]: {
    hazards: ['Slips, trips, and falls','Uneven ground','Workers on foot near equipment','Weather exposure'],
    controls: ['Wear required PPE','Maintain safe distance from equipment','Use designated access routes','Report and correct hazards'],
  },
  [normalizeEntry('Housekeeping')]: {
    hazards: ['Slips, trips, and falls','Poor access/egress','Sharp or protruding materials'],
    controls: ['Keep walkways clear','Remove trip hazards','Maintain clean access/egress','Secure or remove protruding materials'],
  },
  [normalizeEntry('Install/maintain barricades')]: {
    hazards: ['Workers on foot near equipment','Pinch points','Public/pedestrian access','Slips, trips, and falls'],
    controls: ['Use cones, barricades, and signs','Separate workers from public','Wear high-visibility clothing','Maintain communication with operators and supervision'],
  },
  [normalizeEntry('Mass grading')]: {
    hazards: ['Moving equipment','Line of fire','Equipment blind spots','Rollover/runover potential','Dust exposure','Noise and vibration'],
    controls: ['Maintain safe distance from equipment','Stay clear of swing radius and blind spots','Use a spotter','Wear seat belt','Control dust','Use hearing protection'],
  },
  [normalizeEntry('Rough grading')]: {
    hazards: ['Moving equipment','Uneven ground','Equipment blind spots','Rollover/runover potential','Dust exposure'],
    controls: ['Maintain safe distance from equipment','Wear seat belt','Use a spotter','Operate at safe speed','Control dust'],
  },
  [normalizeEntry('Fine grading')]: {
    hazards: ['Moving equipment','Workers on foot near equipment','Equipment blind spots','Dust exposure'],
    controls: ['Maintain safe distance from equipment','Confirm communication before movement','Use a spotter','Control dust'],
  },
  [normalizeEntry('Excavation')]: {
    hazards: ['Cave-in potential','Underground utilities','Open excavation','Workers on foot near equipment','Spoil pile instability','Water accumulation'],
    controls: ['Locate and verify utilities','Maintain current one-call tickets','Use required protective system','Barricade open excavations','Keep spoil piles back','Provide safe access/egress','Inspect excavation before entry'],
  },
  [normalizeEntry('Trenching')]: {
    hazards: ['Cave-in potential','Underground utilities','Open excavation','Poor access/egress','Water accumulation'],
    controls: ['Locate and verify utilities','Use required protective system','Provide safe access/egress','Barricade open excavations','Inspect excavation before entry'],
  },
  [normalizeEntry('Install pipe')]: {
    hazards: ['Caught-between exposure','Pinch points','Suspended loads','Falling objects','Open excavation','Workers on foot near equipment'],
    controls: ['Use approved lifting equipment','Stay clear of suspended loads','Use tag lines when needed','Maintain communication with operator','Use a spotter','Barricade open excavations'],
  },
  [normalizeEntry('Unload pipe and structures')]: {
    hazards: ['Suspended loads','Falling objects','Caught-between exposure','Pinch points','Delivery truck traffic'],
    controls: ['Inspect rigging before use','Stay clear of suspended loads','Use tag lines when needed','Use a spotter','Control delivery traffic','Maintain communication with operators and supervision'],
  },
  [normalizeEntry('Stabilize soil')]: {
    hazards: ['Lime exposure','Silica dust','Eye/skin irritation','Moving equipment','Noise and vibration','Overhead power lines'],
    controls: ['Wear required PPE','Use respiratory protection when required','Apply water for dust control','Maintain safe distance from equipment','Use hearing protection','Maintain power line clearance'],
  },
  [normalizeEntry('Lime delivery')]: {
    hazards: ['Delivery truck traffic','Lime exposure','Dust exposure','Workers on foot near equipment'],
    controls: ['Control delivery traffic','Stage trucks in designated area','Wear required PPE','Maintain safe distance from equipment','Apply water for dust control'],
  },
  [normalizeEntry('Rock delivery')]: {
    hazards: ['Delivery truck traffic','Backing equipment','Line of fire','Equipment blind spots','Dust exposure'],
    controls: ['Control delivery traffic','Stage trucks in designated area','Use a spotter','Wear high-visibility clothing','Maintain safe distance from equipment','Control dust'],
  },
  [normalizeEntry('Stone delivery')]: {
    hazards: ['Delivery truck traffic','Backing equipment','Line of fire','Equipment blind spots','Dust exposure'],
    controls: ['Control delivery traffic','Stage trucks in designated area','Use a spotter','Wear high-visibility clothing','Maintain safe distance from equipment','Control dust'],
  },
  [normalizeEntry('Haul material')]: {
    hazards: ['Haul road traffic','Moving equipment','Dust exposure','Roadway traffic exposure','Unsafe speeds'],
    controls: ['Use designated haul routes','Operate at safe speed','Control dust','Maintain communication with operators and supervision','Stage trucks in designated area'],
  },
  [normalizeEntry('Operate heavy equipment')]: {
    hazards: ['Moving equipment','Equipment blind spots','Rollover/runover potential','Line of fire','Noise and vibration'],
    controls: ['Inspect tools and equipment','Verify horn, lights, and backup alarm','Wear seat belt','Operate at safe speed','Use a spotter','Stay clear of swing radius and blind spots'],
  },
  [normalizeEntry('Back and maneuver equipment')]: {
    hazards: ['Backing equipment','Equipment blind spots','Struck-by exposure','Caught-between exposure'],
    controls: ['Use a spotter','Confirm communication before movement','Verify backup alarm','Stop when visual contact is lost'],
  },
  [normalizeEntry('Spot equipment')]: {
    hazards: ['Struck-by exposure','Line of fire','Equipment blind spots','Loss of communication'],
    controls: ['Use radios or hand signals','Maintain eye contact with operator','Stay visible and outside equipment path','Stop movement when communication is lost'],
  },
  [normalizeEntry('Fuel equipment')]: {
    hazards: ['Fuel/oil exposure','Flammable vapors','Chemical splash','Fire/explosion','Moving equipment'],
    controls: ['Shut down engine before fueling','Keep ignition sources away','Wear required PPE','Clean spills promptly','Keep fire extinguisher available'],
  },
  [normalizeEntry('Service equipment')]: {
    hazards: ['Stored energy','Pinch points','Crush exposure','Hot surfaces','Fuel/oil exposure','Unexpected movement'],
    controls: ['Apply lockout/tagout when required','Park on level ground before servicing','Lower attachments before servicing','Release stored energy','Wear required PPE'],
  },
  [normalizeEntry('Place and compact stone')]: {
    hazards: ['Moving equipment','Workers on foot near equipment','Dust exposure','Flying material','Rollover/runover potential'],
    controls: ['Maintain safe distance from equipment','Use a spotter','Control dust','Wear safety glasses','Wear seat belt'],
  },
  [normalizeEntry('Work near active rail')]: {
    hazards: ['Active rail movement','Rail clearance','Industrial vehicle traffic','Loss of communication'],
    controls: ['Follow railroad safety requirements','Maintain rail clearance','Coordinate with flagger/railroad representative','Stay out of restricted areas unless authorized'],
  },
};

function findTaskSuggestion(taskLabel) {
  const key = normalizeEntry(taskLabel);
  const exact = TASK_SUGGESTIONS[key];
  if (exact) return { task: taskLabel, hazards: dedupeList(exact.hazards), controls: dedupeList(exact.controls), source: 'curated' };

  const allTemplates = TASK_ROW_GROUPS.flatMap(group => group.items || []);
  const template = allTemplates.find(item => {
    const labelKey = normalizeEntry(item.label);
    const stepKey = normalizeEntry(item.step);
    return key === labelKey || key === stepKey || (key.length > 8 && (labelKey.includes(key) || key.includes(labelKey)));
  });
  if (!template) return null;
  return {
    task: taskLabel,
    hazards: dedupeList(splitLines(template.hazards)),
    controls: dedupeList(splitLines(template.controls)),
    source: 'task row template',
  };
}

/* ── Step definitions ── */
const STEPS = [
  { id: 'job', label: 'Job Info', helper: 'Project, site, and emergency details' },
  { id: 'meeting', label: 'Meeting Info', helper: 'Topic, previous day, overall task' },
  { id: 'work', label: 'Tasks / Hazards', helper: 'Daily tasks, hazards, and controls' },
  { id: 'review', label: 'Review', helper: 'Check everything before the crew signs' },
  { id: 'signatures', label: 'Signatures', helper: 'Crew count and acknowledgement' },
  { id: 'export', label: 'Finish & Export', helper: 'Save draft, templates, and export PDF' },
];

// Every real user-entered field, not just the handful originally checked --
// this drives the unsaved-changes guard on Start Blank/Load Template, so a
// gap here means real field data can be silently wiped with no warning.
// Deliberately excludes fields with a non-empty default (date, previousDaySafety,
// acknowledgement) since those are never "empty" and would make the guard fire
// on every untouched draft; also excludes internal-only `notes`, matching this
// function's own prior convention.
function hasMeaningfulJsaContent(jsa) {
  return [
    jsa.location, jsa.jobSite, jsa.jobNumber, jsa.timeIssued, jsa.timeExpired,
    jsa.superintendentForeman, jsa.emergencyPhone, jsa.client, jsa.nearestMedicalFacility,
    jsa.siteContactPhone, jsa.musterPoint, jsa.assignedMentorSse,
    jsa.tailgateTopic, jsa.overallWorkTask, jsa.dailyTasks, jsa.hazardsSummary, jsa.controlsSummary,
  ].some(hasText) || normalizeRows(jsa.taskRows).length > 0;
}
// Field requirements mirror getReviewChecks exactly (job/meeting/work/
// signatures checks) so a step's checkmark can never disagree with what
// Review & Export actually requires -- this used to consider "job" complete
// without checking Date/Emergency Phone/Muster Point (which getReviewChecks
// does require), and "work" complete by looking only at the summary fields,
// ignoring detailed task rows entirely (getReviewChecks uses getContentRows,
// which reconciles both representations).
function stepStatus(jsa, id) {
  switch (id) {
    case 'job':
      return hasText(jsa.location) && hasText(jsa.jobSite) && hasText(jsa.superintendentForeman)
        && hasText(jsa.date) && hasText(jsa.emergencyPhone) && hasText(jsa.musterPoint) ? 'complete' : 'needs-info';
    case 'meeting': return hasText(jsa.tailgateTopic) && hasText(jsa.overallWorkTask) ? 'complete' : 'needs-info';
    case 'work': {
      const rows = getContentRows(jsa);
      return rows.some(row => hasText(row.step)) && rows.some(row => hasText(row.hazards)) && rows.some(row => hasText(row.controls)) ? 'complete' : 'needs-info';
    }
    case 'signatures': return Number(jsa.signatureLineCount) > 0 ? 'complete' : 'needs-info';
    // A checkpoint over job/meeting/work, not its own fields -- complete the
    // instant those three are, so reaching this step is never extra data
    // entry, just a look-over-everything moment before the crew signs.
    case 'review': return ['job', 'meeting', 'work'].every(id => stepStatus(jsa, id) === 'complete') ? 'complete' : 'needs-info';
    case 'export': return jsa.status === 'ready' ? 'ready' : 'draft';
    default: return 'draft';
  }
}
// Derives a "resume here" hint for a returning user from saved draft data alone —
// jsaStep itself is ephemeral React state and is never persisted with the draft.
function nextStepHint(jsa) {
  for (const step of STEPS) {
    if (step.id === 'export') break;
    if (stepStatus(jsa, step.id) !== 'complete') return step.label;
  }
  return 'Finish & Export';
}
// Lightweight completion count for the Home screen's progress indicator —
// deliberately coarser than getReviewChecks (which needs live pagination
// measurements tied to the active jsa, not appropriate for a passive
// dashboard read of a possibly-unopened saved draft).
function draftStepProgress(jsa) {
  const relevant = STEPS.filter(s => s.id !== 'export');
  const done = relevant.filter(s => stepStatus(jsa, s.id) === 'complete').length;
  return { done, total: relevant.length };
}
function getReviewChecks(jsa, measurements) {
  const plan = resolvePagePlan(jsa, measurements);
  const fit = calcFitFromPlan(plan);
  return [
    { label: 'Job site, location, and supervisor', ok: hasText(jsa.jobSite) && hasText(jsa.location) && hasText(jsa.superintendentForeman), step: 'job' },
    { label: 'Date and emergency information', ok: hasText(jsa.date) && hasText(jsa.emergencyPhone) && hasText(jsa.musterPoint), step: 'job' },
    { label: 'Tailgate topic and overall work activity', ok: hasText(jsa.tailgateTopic) && hasText(jsa.overallWorkTask), step: 'meeting' },
    { label: 'At least one task', ok: getContentRows(jsa).some(row => hasText(row.step)), step: 'work' },
    { label: 'Hazards identified', ok: getContentRows(jsa).some(row => hasText(row.hazards)), step: 'work' },
    { label: 'Controls identified', ok: getContentRows(jsa).some(row => hasText(row.controls)), step: 'work' },
    { label: `Signature setup (${signInLineTotal(jsa)} lines)`, ok: Number(jsa.signatureLineCount) >= 1 && Number(jsa.signatureLineCount) <= 100, step: 'signatures' },
    // No single earlier step reliably fixes an overflowing page plan (it can
    // require trimming any of meeting/work/signatures) -- left non-clickable
    // rather than guessing wrong.
    { label: `Page plan (${plan.totalPages} total page${plan.totalPages === 1 ? '' : 's'})`, ok: fit.status !== 'bad' },
  ];
}

function IconLock(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="5" y="10.5" width="14" height="9" rx="1.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>; }

/* ── Sidebar nav icons ── deliberately plain single-stroke line marks (no
   fill, no per-item color) so recognition comes from shape, not a rainbow
   of accent colors — the active/inactive state is carried by the nav
   item's text color, not the icon itself. */
function IconHome(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></svg>; }
function IconDocuments(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M7 3.5h7l3 3v14H7z" /><path d="M14 3.5v3h3" /><path d="M9.5 13h5M9.5 16.5h5" /></svg>; }
function IconDrafts(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 20.5 4.7 17l10-10 3 3-10 10z" /><path d="M13.5 8.2l3 3" /></svg>; }
function IconTemplates(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>; }
function IconSettings(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18 6l-1.7 1.7M7.7 16.3 6 18M18 18l-1.7-1.7M7.7 7.7 6 6" /></svg>; }
function IconChevronRight(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 5l7 7-7 7" /></svg>; }
function IconSearch(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>; }
/* One mark per document type, for Home's start grid — see DOC_ICONS. */
function IconIncident(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4.2" /><path d="M12 17.2h.01" /></svg>; }
function IconWeather(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M7 15.5a3.5 3.5 0 0 1 .4-7A5 5 0 0 1 17 9.3a3.1 3.1 0 0 1 .3 6.2" /><path d="M13 12.5 10 17h3l-1.5 4" /></svg>; }
function IconMedical(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3.5" y="6.5" width="17" height="12" rx="2" /><path d="M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" /><path d="M12 10v5M9.5 12.5h5" /></svg>; }
function IconWarningNote(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4" /><path d="M12 10.5v3.5" /><path d="M12 16.8h.01" /></svg>; }
function IconSeparation(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><path d="M16.5 12h5" /><path d="M19.5 9.5 22 12l-2.5 2.5" /></svg>; }

/* ── Layout capability helpers ──
   Touch-primary detection uses (any-pointer: coarse), a real hardware-capability
   media feature, not a viewport-width guess — this stays correct even if Safari
   reports a desktop-class viewport width for an iPad. Container width is measured
   on the actual rendered element via ResizeObserver, not window.innerWidth. */
function useIsTouchPrimary() {
  const readMatch = () => (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(any-pointer: coarse)').matches
    : false;
  const [touch, setTouch] = useState(readMatch);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(any-pointer: coarse)');
    const handler = () => setTouch(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return touch;
}
function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
function useDebugLayoutFlag() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('debug') === 'layout'; }
    catch { return false; }
  }, []);
}


/* ── Layout diagnostics overlay, only mounted behind ?debug=layout ── */
function LayoutDebugPanel({ containerRef, layoutMode, stepperMode, jobPairMode, quickPanelMode, previewMode }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const onChange = () => forceTick(t => t + 1);
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    window.visualViewport?.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      window.visualViewport?.removeEventListener('resize', onChange);
    };
  }, []);
  const vv = window.visualViewport;
  const coarse = window.matchMedia ? window.matchMedia('(any-pointer: coarse)').matches : false;
  const orientation = screen.orientation?.type || (window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait');
  const containerWidth = containerRef?.current?.clientWidth;
  return (
    <div className="layoutDebugPanel">
      <strong>Layout Debug (?debug=layout)</strong>
      <dl>
        <div><dt>touch-primary</dt><dd>{String(coarse)}</dd></div>
        <div><dt>any-pointer: coarse</dt><dd>{String(coarse)}</dd></div>
        <div><dt>maxTouchPoints</dt><dd>{navigator.maxTouchPoints}</dd></div>
        <div><dt>innerWidth × innerHeight</dt><dd>{window.innerWidth} × {window.innerHeight}</dd></div>
        <div><dt>visualViewport</dt><dd>{vv ? `${Math.round(vv.width)} × ${Math.round(vv.height)}` : 'n/a'}</dd></div>
        <div><dt>screen</dt><dd>{screen.width} × {screen.height}</dd></div>
        <div><dt>devicePixelRatio</dt><dd>{window.devicePixelRatio}</dd></div>
        <div><dt>orientation</dt><dd>{orientation}</dd></div>
        <div><dt>workspace width</dt><dd>{containerWidth != null ? `${containerWidth}px` : 'n/a'}</dd></div>
        <div><dt>live preview mode</dt><dd>{previewMode ?? layoutMode ?? 'n/a'}</dd></div>
        <div><dt>stepper mode</dt><dd>{stepperMode ?? 'n/a'}</dd></div>
        <div><dt>job info pair mode</dt><dd>{jobPairMode ?? 'n/a'}</dd></div>
        <div><dt>QuickPanel mode</dt><dd>{quickPanelMode ?? 'n/a'}</dd></div>
      </dl>
    </div>
  );
}

/* ── Accessible modal dialog primitive: focus trap, Escape to cancel,
   focus returns to whatever triggered it on close. No dependency. ── */
function useFocusTrapDialog(onCancel) {
  const dialogRef = useRef(null);
  // Every caller passes onCancel as an inline arrow function, so it's a new
  // reference on every render of whatever owns the dialog's open/closed
  // state -- with onCancel in the effect's own deps (as this used to be),
  // the "focus the first element" line below re-ran on every one of those
  // re-renders, not just once on open. Typing into any input inside the
  // dialog re-renders its parent, which yanked focus straight back onto the
  // first button -- on a touchscreen that closes the on-screen keyboard
  // after every single keystroke (real bug, Employee Options' Template Name
  // field, 2026-08-17/18). Reading onCancel through a ref instead means the
  // effect only needs to run once, on mount, while still always calling the
  // current onCancel -- initial focus is set once, like a real focus trap,
  // not re-stolen on every keystroke.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog ? Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) : [];
    focusable[0]?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') { onCancelRef.current(); return; }
      if (e.key !== 'Tab' || !focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, []);
  return dialogRef;
}

function ConfirmReplaceDialog({ templateName, isImport, isRepeat, onCancel, onContinue }) {
  const dialogRef = useFocusTrapDialog(onCancel);
  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialogPanel" role="alertdialog" aria-modal="true" aria-labelledby="confirmReplaceTitle" aria-describedby="confirmReplaceBody" ref={dialogRef}>
        <h3 id="confirmReplaceTitle">Replace current draft?</h3>
        <p id="confirmReplaceBody">
          {isImport
            ? "Importing this draft file will replace the JSA you're currently editing on this device. This can't be undone."
            : isRepeat
              ? "Starting a new JSA from the last one's job info will replace the JSA you're currently editing. This can't be undone."
              : templateName
                ? `Loading "${templateName}" will replace the JSA you're currently editing. This can't be undone.`
                : "Starting a new blank JSA will replace the one you're currently editing. This can't be undone."}
        </p>
        <div className="dialogActions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={onContinue}>Continue</button>
        </div>
      </div>
    </div>
  );
}

/* ── Document Options sheet ── infrequent Review-step actions (save-now,
   mark ready, save/update template, legacy print, clear draft) consolidated
   into one drawer instead of a stack of always-visible buttons — reuses the
   same overlay/sheet visual language as the Suggestions sheet (bottom sheet
   on touch, centered dialog on desktop; see .actionSheetOverlay in
   styles.css) and the same focus-trap as every other modal in the app. */
function DocumentOptionsSheet({ onClose, saveDraft, markReady, clearDraft, legacyBrowserPrint, isGenerating }) {
  const dialogRef = useFocusTrapDialog(onClose);
  return (
    <div className="actionSheetOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="actionSheetPanel" role="dialog" aria-modal="true" aria-labelledby="docOptionsTitle" ref={dialogRef}>
        <div className="actionSheetGrabber" aria-hidden="true" />
        <div className="actionSheetHead">
          <strong id="docOptionsTitle">Document Options</strong>
          <button type="button" className="actionSheetCloseBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="actionSheetBody">
          <div className="actionSheetGroup">
            <button type="button" className="actionSheetAction" onClick={() => { saveDraft(); onClose(); }} disabled={isGenerating}>
              <strong>Save Now</strong>
              <span>Drafts already autosave automatically — this is optional.</span>
            </button>
            <button type="button" className="actionSheetAction" onClick={() => { markReady(); onClose(); }} disabled={isGenerating}>
              <strong>Mark Ready</strong>
              <span>Flags this JSA as ready to export.</span>
            </button>
          </div>

          <div className="actionSheetGroup">
            <button type="button" className="actionSheetAction" onClick={() => { legacyBrowserPrint(); onClose(); }} disabled={isGenerating}>
              <strong>Legacy Browser Print</strong>
              <span>Fallback only — can produce incorrect pagination on some devices. Prefer "Create Document" above.</span>
            </button>
          </div>

          <div className="actionSheetDestructive">
            <button type="button" className="btn danger sm" onClick={() => { clearDraft(); onClose(); }} disabled={isGenerating}>Clear Draft</button>
            <p className="helperText">Permanently deletes this draft from this device. This cannot be undone.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Task suggestion bundle modals: adding a task with related hazards/
   controls, and reversing that bundle later. Centered, dimmed, blocks the
   Suggestions sheet behind it (which stays mounted so its search/scroll
   state survives Cancel) instead of closing it. ── */
function TaskSuggestionModal({ task, hazards, controls, onCancel, onTaskOnly, onAddSelected }) {
  const [selectedHazards, setSelectedHazards] = useState(hazards);
  const [selectedControls, setSelectedControls] = useState(controls);
  const dialogRef = useFocusTrapDialog(onCancel);
  function toggle(list, setter, item) {
    setter(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  }
  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialogPanel suggestionModalPanel" role="dialog" aria-modal="true" aria-labelledby="taskSuggestionTitle" ref={dialogRef}>
        <h3 id="taskSuggestionTitle">Add related suggestions?</h3>
        <div className="suggestionModalTask">
          <span>Task</span>
          <strong>{task}</strong>
        </div>
        <div className="suggestionModalBody">
          {hazards.length > 0 && (
            <div className="suggestionModalGroup">
              <strong>Suggested hazards</strong>
              {hazards.map(item => (
                <label className="suggestionCheck" key={item}>
                  <input type="checkbox" checked={selectedHazards.includes(item)} onChange={() => toggle(selectedHazards, setSelectedHazards, item)} />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          )}
          {controls.length > 0 && (
            <div className="suggestionModalGroup">
              <strong>Suggested controls</strong>
              {controls.map(item => (
                <label className="suggestionCheck" key={item}>
                  <input type="checkbox" checked={selectedControls.includes(item)} onChange={() => toggle(selectedControls, setSelectedControls, item)} />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="dialogActions suggestionModalActions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn secondary" onClick={onTaskOnly}>Add Task Only</button>
          <button className="btn primary" onClick={() => onAddSelected(selectedHazards, selectedControls)}>Add Selected Suggestions</button>
        </div>
      </div>
    </div>
  );
}
function RemoveBundleModal({ task, hazards, controls, onCancel, onRemoveTaskOnly, onRemoveBundle }) {
  const dialogRef = useFocusTrapDialog(onCancel);
  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialogPanel suggestionModalPanel" role="dialog" aria-modal="true" aria-labelledby="removeBundleTitle" ref={dialogRef}>
        <h3 id="removeBundleTitle">Remove {task}?</h3>
        <div className="suggestionModalBody">
          <p>This task added:</p>
          {hazards.length > 0 && (
            <div className="suggestionModalGroup">
              <strong>Hazards</strong>
              <ul className="suggestionModalList">{hazards.map(h => <li key={h}>{h}</li>)}</ul>
            </div>
          )}
          {controls.length > 0 && (
            <div className="suggestionModalGroup">
              <strong>Controls</strong>
              <ul className="suggestionModalList">{controls.map(c => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {hazards.length === 0 && controls.length === 0 && (
            <p className="helperText">Its suggested items were already present or have since been edited, so only the task will be removed either way.</p>
          )}
        </div>
        <div className="dialogActions suggestionModalActions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn secondary" onClick={onRemoveTaskOnly}>Remove Task Only</button>
          <button className="btn danger" onClick={onRemoveBundle}>Remove Task and Added Suggestions</button>
        </div>
      </div>
    </div>
  );
}

/* ── App ── */
function App() {
  const [settings, setSettings] = useState(() => ({ theme: 'light', customQuick: { task: [], hazard: [], control: [] }, ...safeJson(localStorage.getItem(KEYS.settings), {}) }));
  const [customTemplates, setCustomTemplates] = useState(() => safeJson(localStorage.getItem(KEYS.templates), []));
  const [savedDraft, setSavedDraft] = useState(() => safeJson(localStorage.getItem(KEYS.draft), null));
  const [jsa, setJsa] = useState(() => emptyJsa());
  const [tab, setTab] = useState('home');
  const [activeDoc, setActiveDoc] = useState(null); // null | 'jsa-start' | 'jsa' | 'incident'
  const [jsaStep, setJsaStep] = useState('job');

  // ── Incident Report state (fully separate from JSA state/storage above) ──
  const [savedIncidentDraft, setSavedIncidentDraft] = useState(() => migrateIncidentShape(loadIncidentDraft()));
  const [incident, setIncident] = useState(() => emptyIncident());
  const [incidentStep, setIncidentStep] = useState('details');
  const [incidentSaveStatus, setIncidentSaveStatus] = useState('idle');
  const incidentAutoSaveTimer = useRef(null);
  const lastIncidentAutoSaveSnapshot = useRef('');
  const [incidentPdfExportState, setIncidentPdfExportState] = useState(null);
  const incidentPdfPageRefsRef = useRef([]);
  const isIncidentPdfStale = incidentPdfExportState?.phase === 'ready' && incidentPdfExportState.fingerprint !== incidentPdfFingerprint(incident);
  const incidentSaveStatusLabel = incidentSaveStatus === 'saving' ? incidentCopy.autosaveSaving
    : incidentSaveStatus === 'error' ? incidentCopy.autosaveError
    : incidentSaveStatus === 'saved' ? incidentCopy.autosaveSaved
    : (incident.lastSavedAt ? incidentCopy.autosaveSaved : 'Not saved yet');
  // ── Employee Disciplinary Notice state (fully separate storage/state from
  // JSA/Incident above — see useDraftDocument.js for the shared shape this
  // and the other three new documents all use). ──
  const disciplinary = useDraftDocument({
    storageKey: DOCUMENT_STORAGE_KEYS.disciplinary,
    emptyModel: emptyDisciplinary,
    hasMeaningfulContent: hasMeaningfulDisciplinaryContent,
    firstStepId: 'notice',
    active: activeDoc === 'disciplinary',
  });
  const disciplinaryPdf = usePdfExport({
    buildFilename: () => `${buildDisciplinaryExportName(disciplinary.model)}.pdf`,
    fingerprint: `${printedFingerprint(disciplinary.model)}|${isDisciplinaryPrintFinal(disciplinary.model)}`,
    showToast: msg => showToast(msg),
    // Drawn directly into the PDF rather than screenshotted — see pdfDraw.js.
    // Disciplinary is the first document on this path; the other three still
    // use the capture pipeline until this one is proven.
    renderPdf: onProgress => drawDisciplinaryPdf(disciplinary.model, onProgress),
  });

  // ── Uncontrolled Event Report state ──
  const uncontrolledEvent = useDraftDocument({
    storageKey: DOCUMENT_STORAGE_KEYS.uncontrolledEvent,
    emptyModel: emptyUncontrolledEvent,
    hasMeaningfulContent: hasMeaningfulUncontrolledEventContent,
    migrateShape: migrateUncontrolledEventShape,
    firstStepId: 'event',
    active: activeDoc === 'uncontrolledEvent',
  });
  const uncontrolledEventPdf = usePdfExport({
    buildFilename: () => `${buildUncontrolledEventExportName(uncontrolledEvent.model)}.pdf`,
    fingerprint: `${printedFingerprint(uncontrolledEvent.model)}|${isUncontrolledEventPrintFinal(uncontrolledEvent.model)}`,
    showToast: msg => showToast(msg),
    renderPdf: onProgress => drawUncontrolledEventPdf(uncontrolledEvent.model, onProgress),
  });

  // ── Employee Medical Event state ──
  const medicalEvent = useDraftDocument({
    storageKey: DOCUMENT_STORAGE_KEYS.medicalEvent,
    emptyModel: emptyMedicalEvent,
    hasMeaningfulContent: hasMeaningfulMedicalEventContent,
    firstStepId: 'condition',
    active: activeDoc === 'medicalEvent',
  });
  const medicalEventPdf = usePdfExport({
    buildFilename: () => `${buildMedicalEventExportName(medicalEvent.model)}.pdf`,
    fingerprint: `${printedFingerprint(medicalEvent.model)}|${isMedicalEventPrintFinal(medicalEvent.model)}`,
    showToast: msg => showToast(msg),
    renderPdf: onProgress => drawMedicalEventPdf(medicalEvent.model, onProgress),
  });

  // ── Employee Separation state ──
  const separation = useDraftDocument({
    storageKey: DOCUMENT_STORAGE_KEYS.separation,
    emptyModel: emptySeparation,
    hasMeaningfulContent: hasMeaningfulSeparationContent,
    migrateShape: migrateSeparationShape,
    firstStepId: 'details',
    active: activeDoc === 'separation',
  });
  const separationPdf = usePdfExport({
    buildFilename: () => `${buildSeparationExportName(separation.model)}.pdf`,
    fingerprint: `${printedFingerprint(separation.model)}|${isSeparationPrintFinal(separation.model)}`,
    showToast: msg => showToast(msg),
    renderPdf: onProgress => drawSeparationPdf(separation.model, onProgress),
  });

  const [templateId, setTemplateId] = useState('blank-jsa');
  const [saveName, setSaveName] = useState('');
  const [toast, setToast] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [confirmReplace, setConfirmReplace] = useState(null); // null | { action: 'blank' } | { action: 'template', templateId }
  const autoSaveTimer = useRef(null);
  const lastAutoSaveSnapshot = useRef('');
  // null (idle)
  // | { phase: 'generating', status: 'preparing'|'rendering'|'finalizing', pageIndex?, totalPages? }
  // | { phase: 'ready', blob, filename, pageCount, fingerprint, shareMessage }
  const [pdfExportState, setPdfExportState] = useState(null);
  const pdfExportPageRefsRef = useRef([]);
  const pdfExportPlan = useJsaPagePlan(jsa);
  // True once the draft has changed materially since the currently-held PDF
  // was generated — reusing the same content fingerprint the pagination
  // system already computes, since it already covers every field the
  // printed/exported document actually shows (job info, meeting info, task
  // rows, signature count) and deliberately excludes non-printed fields
  // like internal notes, so editing notes alone does not falsely mark a
  // perfectly current PDF as stale.
  const isPdfStale = pdfExportState?.phase === 'ready' && pdfExportState.fingerprint !== fingerprintPaginationInput(jsa);

  const allTemplates = useMemo(() => [...BUILT_IN_TEMPLATES, ...customTemplates], [customTemplates]);
  const isTouchPrimary = useIsTouchPrimary();

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || 'light';
    localStorage.setItem(KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    // Application-level layout signal every component can key off via CSS
    // (html[data-pointer='coarse']) without prop drilling. Based on the real
    // (any-pointer: coarse) capability, not viewport width or UA sniffing.
    document.documentElement.dataset.pointer = isTouchPrimary ? 'coarse' : 'fine';
  }, [isTouchPrimary]);

  useEffect(() => {
    localStorage.setItem(KEYS.templates, JSON.stringify(customTemplates));
  }, [customTemplates]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!import.meta.env.PROD) {
      navigator.serviceWorker.getRegistrations().then(registrations => registrations.forEach(registration => registration.unregister()));
      if ('caches' in window) caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
      return;
    }
    const register = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);


  useEffect(() => {
    if (activeDoc !== 'jsa') return undefined;
    if (!hasMeaningfulJsaContent(jsa)) return undefined;
    const snapshot = JSON.stringify({ ...jsa, lastSavedAt: '' });
    if (snapshot === lastAutoSaveSnapshot.current) return undefined;
    setSaveStatus('saving');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const next = { ...jsa, status: jsa.status === 'ready' ? 'ready' : 'draft', lastSavedAt: new Date().toISOString() };
      try {
        localStorage.setItem(KEYS.draft, JSON.stringify(next));
        lastAutoSaveSnapshot.current = snapshot;
        setSavedDraft(next);
        setJsa(prev => ({ ...prev, lastSavedAt: next.lastSavedAt }));
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 900);
    return () => clearTimeout(autoSaveTimer.current);
  }, [jsa, activeDoc]);

  // Incident Report autosave — same 900ms debounce shape as the JSA
  // autosave above, but reads/writes only sdc.incident.* keys.
  useEffect(() => {
    if (activeDoc !== 'incident') return undefined;
    if (!hasMeaningfulIncidentContent(incident)) return undefined;
    const snapshot = JSON.stringify({ ...incident, lastSavedAt: '' });
    if (snapshot === lastIncidentAutoSaveSnapshot.current) return undefined;
    setIncidentSaveStatus('saving');
    clearTimeout(incidentAutoSaveTimer.current);
    incidentAutoSaveTimer.current = setTimeout(() => {
      const next = { ...incident, lastSavedAt: new Date().toISOString() };
      if (saveIncidentDraft(next)) {
        lastIncidentAutoSaveSnapshot.current = snapshot;
        setSavedIncidentDraft(next);
        setIncident(prev => ({ ...prev, lastSavedAt: next.lastSavedAt }));
        setIncidentSaveStatus('saved');
      } else {
        setIncidentSaveStatus('error');
      }
    }, 900);
    return () => clearTimeout(incidentAutoSaveTimer.current);
  }, [incident, activeDoc]);

  function upd(patch) { setJsa(prev => ({ ...prev, ...patch })); }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  function goHome() { setTab('home'); setActiveDoc(null); }
  function goDocs() { setTab('documents'); setActiveDoc(null); }
  function goJsaStart() { setTab('documents'); setActiveDoc('jsa-start'); }
  function goJsa(step = 'job') { setTab('documents'); setActiveDoc('jsa'); setJsaStep(step); }
  function goIncident(step = 'details') { setTab('documents'); setActiveDoc('incident'); setIncidentStep(step); }
  function goDisciplinary() { setTab('documents'); setActiveDoc('disciplinary'); }

  // Shared entry-point builder for the four new useDraftDocument-backed
  // documents — same "confirm before replacing meaningful existing content"
  // contract JSA/Incident's own requestStartBlank functions implement by
  // hand, generalized once instead of copy-pasted per document. `activate`
  // is the doc's own goX() above (sets tab/activeDoc so its builder mounts).
  function makeDraftEntryPoints(doc, activate, confirmMessage, docLabel) {
    function startBlank() {
      doc.resetToBlank();
      activate();
    }
    function requestStartBlank() {
      if (doc.hasExistingContent() && !confirm(confirmMessage)) return;
      startBlank();
    }
    function loadSavedDraft() {
      if (!doc.loadSaved()) { showToast('No saved draft found on this device.'); return; }
      activate();
      showToast('Saved draft loaded.');
    }
    // Entry point for an imported draft file (see importDraftFile below) —
    // same "confirm before replacing meaningful existing content" guard as
    // every other entry point here, so importing can never silently wipe
    // out in-progress work on this device.
    function importDraft(data) {
      if (doc.hasExistingContent() && !confirm(`Importing this draft will replace the current ${docLabel} on this device. Continue?`)) return false;
      doc.replaceWith(data);
      activate();
      showToast(`${docLabel} draft imported. Review each step and finish when ready.`);
      return true;
    }
    return { startBlank, requestStartBlank, loadSavedDraft, importDraft };
  }

  const disciplinaryEntry = makeDraftEntryPoints(
    disciplinary, goDisciplinary,
    'Starting a new disciplinary notice will replace the current draft. Continue?',
    'disciplinary notice'
  );
  function markDisciplinaryReady() {
    if (disciplinary.markReady(isDisciplinaryReady)) showToast('Marked complete and locked from editing.');
    else showToast(disciplinary.saveStatus === 'error' ? 'Save failed. Check available storage on this device.' : 'Complete all required fields before finishing.');
  }
  function markDisciplinaryIncomplete() {
    if (disciplinary.markIncomplete()) showToast('Unlocked for editing.');
    else showToast('Save failed. Check available storage on this device.');
  }
  function startNewDisciplinary() {
    if (disciplinary.hasExistingContent() && !confirm('Start a new disciplinary notice? The current one will be cleared from this device.')) return;
    disciplinaryEntry.startBlank();
    showToast('Started a new disciplinary notice.');
  }

  const uncontrolledEventEntry = makeDraftEntryPoints(
    uncontrolledEvent, () => { setTab('documents'); setActiveDoc('uncontrolledEvent'); },
    'Starting a new uncontrolled event report will replace the current draft. Continue?',
    'uncontrolled event report'
  );
  function markUncontrolledEventReady() {
    if (uncontrolledEvent.markReady(isUncontrolledEventReady)) showToast('Marked complete and locked from editing.');
    else showToast(uncontrolledEvent.saveStatus === 'error' ? 'Save failed. Check available storage on this device.' : 'Complete all required fields before finishing.');
  }
  function markUncontrolledEventIncomplete() {
    if (uncontrolledEvent.markIncomplete()) showToast('Unlocked for editing.');
    else showToast('Save failed. Check available storage on this device.');
  }
  function startNewUncontrolledEvent() {
    if (uncontrolledEvent.hasExistingContent() && !confirm('Start a new uncontrolled event report? The current one will be cleared from this device.')) return;
    uncontrolledEventEntry.startBlank();
    showToast('Started a new uncontrolled event report.');
  }

  const medicalEventEntry = makeDraftEntryPoints(
    medicalEvent, () => { setTab('documents'); setActiveDoc('medicalEvent'); },
    'Starting a new medical event report will replace the current draft. Continue?',
    'medical event report'
  );
  function markMedicalEventReady() {
    if (medicalEvent.markReady(isMedicalEventReady)) showToast('Marked complete and locked from editing.');
    else showToast(medicalEvent.saveStatus === 'error' ? 'Save failed. Check available storage on this device.' : 'Complete all required fields before finishing.');
  }
  function markMedicalEventIncomplete() {
    if (medicalEvent.markIncomplete()) showToast('Unlocked for editing.');
    else showToast('Save failed. Check available storage on this device.');
  }
  function startNewMedicalEvent() {
    if (medicalEvent.hasExistingContent() && !confirm('Start a new medical event report? The current one will be cleared from this device.')) return;
    medicalEventEntry.startBlank();
    showToast('Started a new medical event report.');
  }

  const separationEntry = makeDraftEntryPoints(
    separation, () => { setTab('documents'); setActiveDoc('separation'); },
    'Starting a new employee separation record will replace the current draft. Continue?',
    'employee separation record'
  );
  function markSeparationReady() {
    if (separation.markReady(isSeparationReady)) showToast('Marked complete and locked from editing.');
    else showToast(separation.saveStatus === 'error' ? 'Save failed. Check available storage on this device.' : 'Complete all required fields before finishing.');
  }
  function markSeparationIncomplete() {
    if (separation.markIncomplete()) showToast('Unlocked for editing.');
    else showToast('Save failed. Check available storage on this device.');
  }
  function startNewSeparation() {
    if (separation.hasExistingContent() && !confirm('Start a new employee separation record? The current one will be cleared from this device.')) return;
    separationEntry.startBlank();
    showToast('Started a new employee separation record.');
  }

  // Shared reset used by every "start fresh" entry point -- clears BOTH the
  // persisted draft and the in-memory/autosave-tracking state, so a
  // subsequent autosave can never silently overwrite the just-discarded
  // saved report with new blank-report edits. Also cleans up any photo
  // blobs the discarded draft owned in IndexedDB (see
  // incidentPhotoStorage.js) -- single-draft-slot model, so the report
  // being replaced here is gone for good and must not leave orphaned photo
  // blobs behind. Best-effort: a cleanup failure must never block starting
  // the new report.
  function resetIncidentToBlank() {
    const discardedId = incident.id;
    clearIncidentDraft();
    setSavedIncidentDraft(null);
    setIncident(emptyIncident());
    setIncidentPdfExportState(null);
    lastIncidentAutoSaveSnapshot.current = '';
    if (discardedId) deletePhotosForIncident(discardedId).catch(() => { /* non-fatal */ });
  }
  function startIncidentBlank() {
    resetIncidentToBlank();
    goIncident('details');
  }
  // Entry point for both "Start Incident Report" (Home) and "Start" under
  // Documents. Meaningful data can exist either in the in-memory `incident`
  // (mid-edit, not yet reflected in savedIncidentDraft) or in the persisted
  // draft (savedIncidentDraft / localStorage) -- checking only one of the
  // two previously let a real saved report get silently discarded whenever
  // the in-memory object happened to still be blank.
  function requestStartIncidentBlank() {
    const persisted = loadIncidentDraft() || savedIncidentDraft;
    const hasExisting = hasMeaningfulIncidentContent(persisted) || hasMeaningfulIncidentContent(incident);
    if (hasExisting && !confirm(incidentCopy.confirmReplaceDraft)) return;
    startIncidentBlank();
  }
  function loadSavedIncidentDraft() {
    const raw = loadIncidentDraft() || savedIncidentDraft;
    if (!raw) { showToast('No saved incident report found on this device.'); return; }
    const normalized = { ...emptyIncident(), ...migrateIncidentShape(raw) };
    setIncident(normalized);
    setSavedIncidentDraft(normalized);
    setIncidentPdfExportState(null);
    goIncident('details');
    showToast('Saved incident report loaded.');
  }
  function startNewIncidentReport() {
    if (hasMeaningfulIncidentContent(incident) && !confirm('Start a new incident report? The current one will be cleared from this device.')) return;
    resetIncidentToBlank();
    goIncident('details');
    showToast('Started a new incident report.');
  }
  // Entry point for an imported Incident draft file (see importDraftFile
  // below) — same normalization loadSavedIncidentDraft() applies to this
  // device's own localStorage, persisted immediately, and guarded the same
  // way every other "replace the current incident report" action here is.
  function importIncidentDraft(data) {
    const normalized = { ...emptyIncident(), ...migrateIncidentShape(data) };
    setIncident(normalized);
    setSavedIncidentDraft(normalized);
    setIncidentPdfExportState(null);
    saveIncidentDraft(normalized);
    goIncident('details');
    showToast('Incident report draft imported. Review each step and finish when ready.');
  }
  function requestImportIncident(data) {
    const persisted = loadIncidentDraft() || savedIncidentDraft;
    const hasExisting = hasMeaningfulIncidentContent(persisted) || hasMeaningfulIncidentContent(incident);
    if (hasExisting && !confirm('Importing this draft will replace the current incident report on this device. Continue?')) return;
    importIncidentDraft(data);
  }

  // Cancels any pending autosave timer and writes the exact current report
  // immediately -- used by the always-visible "Save Now" action. Must never
  // report success ("Saved") when the write actually failed.
  function saveIncidentNow() {
    clearTimeout(incidentAutoSaveTimer.current);
    setIncidentSaveStatus('saving');
    const next = { ...incident, lastSavedAt: new Date().toISOString() };
    if (saveIncidentDraft(next)) {
      lastIncidentAutoSaveSnapshot.current = JSON.stringify({ ...next, lastSavedAt: '' });
      setIncident(next);
      setSavedIncidentDraft(next);
      setIncidentSaveStatus('saved');
    } else {
      setIncidentSaveStatus('error');
    }
  }

  function markIncidentReady() {
    if (!isIncidentReady(incident)) { showToast('Complete all required fields before finishing.'); return; }
    clearTimeout(incidentAutoSaveTimer.current);
    const next = { ...incident, status: 'ready', lastSavedAt: new Date().toISOString() };
    if (saveIncidentDraft(next)) {
      lastIncidentAutoSaveSnapshot.current = JSON.stringify({ ...next, lastSavedAt: '' });
      setIncident(next);
      setSavedIncidentDraft(next);
      setIncidentSaveStatus('saved');
      showToast('Marked complete and locked from editing.');
    } else {
      setIncidentSaveStatus('error');
      showToast('Save failed. Check available storage on this device.');
    }
  }

  function markIncidentIncomplete() {
    clearTimeout(incidentAutoSaveTimer.current);
    const next = { ...incident, status: 'draft', completedAt: '', lastSavedAt: new Date().toISOString() };
    if (saveIncidentDraft(next)) {
      lastIncidentAutoSaveSnapshot.current = JSON.stringify({ ...next, lastSavedAt: '' });
      setIncident(next);
      setSavedIncidentDraft(next);
      setIncidentSaveStatus('saved');
      showToast('Unlocked for editing.');
    } else {
      setIncidentSaveStatus('error');
      showToast('Save failed. Check available storage on this device.');
    }
  }

  async function exportIncidentPdf() {
    if (incidentPdfExportState?.phase === 'generating') return;
    const overflowFields = getIncidentPdfOverflowFields(incident);
    if (overflowFields.length) {
      showToast(`Too long to export (shorten before exporting): ${overflowFields.join(', ')}`);
      return;
    }
    const draft = !isIncidentPrintFinal(incident);
    const filename = `${buildIncidentExportName(incident)}.pdf`;
    const fingerprint = incidentPdfFingerprint(incident);
    try {
      setIncidentPdfExportState({ phase: 'generating', status: 'preparing' });
      const { blob, pageCount } = await generateIncidentPdf(incidentPdfPageRefsRef, (pageIndex, totalPages) => {
        setIncidentPdfExportState({ phase: 'generating', status: 'rendering', pageIndex, totalPages });
      });
      setIncidentPdfExportState({ phase: 'ready', blob, filename, pageCount, fingerprint, shareMessage: null });
      const savedAt = new Date().toISOString();
      if (!draft) {
        const completed = { ...incident, status: 'completed', completedAt: savedAt, lastSavedAt: savedAt };
        saveIncidentDraft(completed);
        setIncident(completed);
        setSavedIncidentDraft(completed);
        upsertIncidentRecord(completed, { pageCount });
      } else {
        const savedNow = { ...incident, lastSavedAt: savedAt };
        saveIncidentDraft(savedNow);
        setIncident(savedNow);
        setSavedIncidentDraft(savedNow);
      }
    } catch (err) {
      console.error('[incident pdf export]', err);
      showToast(`PDF export failed (${err?.message || 'unknown error'}).`);
      setIncidentPdfExportState(null);
    }
  }

  function shareIncidentPdfClick() {
    if (!incidentPdfExportState || incidentPdfExportState.phase !== 'ready') return;
    if (isIncidentPdfStale) return;
    const file = new File([incidentPdfExportState.blob], incidentPdfExportState.filename, { type: 'application/pdf' });
    const result = shareGeneratedPdf(file);
    if (!result.ok) {
      setIncidentPdfExportState(prev => (prev && prev.phase === 'ready' ? { ...prev, shareMessage: result.reason } : prev));
      return;
    }
    result.promise
      .then(() => setIncidentPdfExportState(prev => (prev && prev.phase === 'ready' ? { ...prev, shareMessage: null } : prev)))
      .catch(err => {
        if (err && err.name === 'AbortError') return;
        console.error('[incident pdf share]', err);
        setIncidentPdfExportState(prev => (prev && prev.phase === 'ready'
          ? { ...prev, shareMessage: `Sharing failed (${err?.name || err?.message || 'unknown error'}). Try again, or use Download PDF.` }
          : prev));
      });
  }
  function downloadIncidentPdfClick() {
    if (!incidentPdfExportState || incidentPdfExportState.phase !== 'ready') return;
    if (isIncidentPdfStale) return;
    downloadGeneratedPdf(incidentPdfExportState.blob, incidentPdfExportState.filename);
    showToast(`PDF downloaded: ${incidentPdfExportState.filename}`);
  }

  function saveDraft(msg = true) {
    const next = { ...jsa, status: 'draft', lastSavedAt: new Date().toISOString() };
    try {
      localStorage.setItem(KEYS.draft, JSON.stringify(next));
      setJsa(next);
      setSavedDraft(next);
      setSaveStatus('saved');
      if (msg) showToast('Draft saved on this device.');
    } catch {
      setSaveStatus('error');
      if (msg) showToast('Save failed. Check available storage on this device.');
    }
  }
  function markReady() {
    const next = { ...jsa, status: 'ready', lastSavedAt: new Date().toISOString() };
    try {
      localStorage.setItem(KEYS.draft, JSON.stringify(next));
      setJsa(next);
      setSavedDraft(next);
      setSaveStatus('saved');
      showToast('Marked ready to export. Save the PDF outside the app.');
    } catch {
      setSaveStatus('error');
      showToast('Save failed. Check available storage on this device.');
    }
  }
  function clearDraft() {
    if (!confirm('Clear this JSA draft? Custom templates will not be affected.')) return;
    setJsa(emptyJsa());
    localStorage.removeItem(KEYS.draft);
    setSavedDraft(null);
    setTemplateId('blank-jsa');
    goJsaStart();
    showToast('JSA draft cleared.');
  }
  function loadTemplate(id = templateId) {
    const t = allTemplates.find(x => x.id === id);
    if (!t) return;
    const next = t.id === 'blank-jsa' ? emptyJsa() : makeTodayFromTemplate(t.data);
    setJsa(next);
    setTemplateId(id);
    goJsa('job');
    showToast(`Loaded: ${t.name}`);
  }
  function loadSavedDraft() {
    const raw = safeJson(localStorage.getItem(KEYS.draft), savedDraft);
    if (!raw) { showToast('No saved draft found on this device.'); return; }
    const normalized = { ...emptyJsa(), ...raw, taskRows: withRowIds(raw.taskRows) };
    setJsa(normalized);
    setSavedDraft(normalized);
    setTemplateId('blank-jsa');
    goJsa('job');
    showToast('Saved draft loaded.');
  }
  function startBlank() {
    setJsa(emptyJsa());
    setTemplateId('blank-jsa');
    goJsa('job');
  }
  function requestStartBlank() {
    if (hasMeaningfulJsaContent(jsa)) { setConfirmReplace({ action: 'blank' }); return; }
    startBlank();
  }
  function requestLoadTemplate(id) {
    if (hasMeaningfulJsaContent(jsa)) { setConfirmReplace({ action: 'template', templateId: id }); return; }
    loadTemplate(id);
  }
  // "Repeat Last JSA" -- same job info/tasks/hazards/controls as the most
  // recently saved JSA, day-specific fields reset, no template save/name
  // step required. Templates are for reusable named scopes of work; this is
  // for "tomorrow's JSA is basically today's" without going through that
  // (Fonzo, 2026-08-29: "the templates are just for different scopes of
  // work... if the JSA is not changing"). Reuses makeTodayFromTemplate's
  // exact reset shape -- the saved draft is treated as an implicit,
  // unnamed template.
  function repeatLastJsa() {
    if (!savedDraft) return;
    const next = makeTodayFromTemplate(savedDraft);
    setJsa(next);
    setTemplateId('blank-jsa');
    goJsa('job');
    showToast('Started a new JSA using the last one’s job info and tasks.');
  }
  function requestRepeatLastJsa() {
    if (!savedDraft) return;
    if (hasMeaningfulJsaContent(jsa)) { setConfirmReplace({ action: 'repeat' }); return; }
    repeatLastJsa();
  }
  // Entry point for an imported JSA draft file (see importDraftFile below) —
  // same normalization loadSavedDraft() applies to this device's own
  // localStorage, persisted immediately, and guarded by the same
  // ConfirmReplaceDialog every other JSA "replace the draft" action uses.
  function loadImportedJsa(data) {
    const normalized = { ...emptyJsa(), ...data, taskRows: withRowIds(data.taskRows) };
    setJsa(normalized);
    setSavedDraft(normalized);
    setTemplateId('blank-jsa');
    localStorage.setItem(KEYS.draft, JSON.stringify(normalized));
    goJsa('job');
    showToast('JSA draft imported. Review each step and finish when ready.');
  }
  function requestImportJsa(data) {
    if (hasMeaningfulJsaContent(jsa)) { setConfirmReplace({ action: 'import', importData: data }); return; }
    loadImportedJsa(data);
  }
  function confirmReplaceContinue() {
    if (confirmReplace?.action === 'blank') startBlank();
    else if (confirmReplace?.action === 'template') loadTemplate(confirmReplace.templateId);
    else if (confirmReplace?.action === 'import') loadImportedJsa(confirmReplace.importData);
    else if (confirmReplace?.action === 'repeat') repeatLastJsa();
    setConfirmReplace(null);
  }
  function confirmReplaceCancel() { setConfirmReplace(null); }

  // Single entry point for "Import a Draft" on the Documents tab — reads
  // whatever file was picked, validates it's a recognized draft-file
  // envelope (see parseDraftFileText), and routes to the correct document
  // type's own import handler based on the file's own docType, not
  // whichever button the user happened to click. Never touches any app
  // state until the file has been fully validated.
  async function importDraftFile(file) {
    let text;
    try {
      text = await readFileAsText(file);
    } catch {
      showToast('Could not read that file.');
      return;
    }
    const parsed = parseDraftFileText(text);
    if (!parsed.ok) { showToast(parsed.error); return; }
    const { docType, data } = parsed;
    if (docType === 'jsa') { requestImportJsa(data); return; }
    if (docType === 'incident') { requestImportIncident(data); return; }
    const entryByType = {
      disciplinary: disciplinaryEntry,
      uncontrolledEvent: uncontrolledEventEntry,
      medicalEvent: medicalEventEntry,
      separation: separationEntry,
    };
    const entry = entryByType[docType];
    if (!entry) { showToast('Unrecognized document type in that file.'); return; }
    entry.importDraft(data);
  }
  function saveTemplate() {
    const name = saveName.trim();
    if (!name) { showToast('Enter a name for the template first.'); return; }
    const t = templatePayload(jsa, name);
    setCustomTemplates(prev => [t, ...prev.filter(x => x.name.toLowerCase() !== name.toLowerCase())]);
    setSaveName('');
    showToast(`Saved template: ${name}`);
  }
  function updateTemplate() {
    const curr = customTemplates.find(t => t.name === jsa.templateName || t.id === templateId);
    if (!curr) { showToast('Load a custom template first, or use Save Custom Template.'); return; }
    const updated = templatePayload(jsa, curr.name);
    updated.id = curr.id;
    updated.createdAt = curr.createdAt;
    setCustomTemplates(prev => prev.map(t => t.id === curr.id ? updated : t));
    showToast(`Updated template: ${curr.name}`);
  }
  function deleteTemplate(id) {
    const t = customTemplates.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`Delete template "${t.name}"?`)) return;
    setCustomTemplates(prev => prev.filter(x => x.id !== id));
    if (templateId === id) setTemplateId('blank-jsa');
    showToast('Template deleted.');
  }
  // Share/Import a saved TEMPLATE (job info, hazards, controls -- day fields
  // already wiped) as a small file, same text/email/AirDrop mechanism as
  // Import a Draft on the Documents tab, but a separate envelope kind (see
  // TEMPLATE_EXPORT_KIND) so it can never land in the single live-draft
  // slot by mistake. Replaces "Send to Someone Else to Finish" on the JSA
  // Review step, which didn't fit how JSAs actually get used (Fonzo,
  // 2026-08-17/18: "whoever starts the JSA finishes it" -- but sharing a
  // reusable template with someone else is a real, different thing).
  function shareTemplate(t) {
    // Not buildDraftFilename -- that always appends "_Draft_<date>", which
    // reads as wrong (this is a template, not a draft).
    const day = new Date().toISOString().slice(0, 10);
    downloadTemplateFile('jsa', t.data, `${sanitizeForFilename(t.name)}_JSA_Template_${day}`);
  }
  async function importTemplateFile(file) {
    let text;
    try {
      text = await readFileAsText(file);
    } catch {
      showToast('Could not read that file.');
      return;
    }
    const parsed = parseTemplateFileText(text);
    if (!parsed.ok) { showToast(parsed.error); return; }
    if (parsed.docType !== 'jsa') { showToast('This app only supports importing JSA templates right now.'); return; }
    const name = parsed.data.templateName?.trim() || 'Imported Template';
    const t = {
      id: crypto.randomUUID?.() || String(Date.now()),
      source: 'custom',
      name,
      description: 'Imported JSA template',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { ...parsed.data, templateName: name },
    };
    setCustomTemplates(prev => [t, ...prev.filter(x => x.name.toLowerCase() !== name.toLowerCase())]);
    showToast(`Imported template: ${name}`);
  }

  // Editing/removing only -- creating new detailed task rows was removed
  // (2026-08-19, Fonzo) since it was a confusing second way to enter the
  // same task/hazard/control data the summary fields above already cover.
  // These stay so any row still sitting in an old draft/template stays
  // editable and removable rather than silently locked.
  function updRow(i, patch) {
    const rows = [...(jsa.taskRows || [])];
    rows[i] = { ...rows[i], ...patch };
    upd({ taskRows: rows });
  }
  function removeRow(i) { upd({ taskRows: (jsa.taskRows || []).filter((_, x) => x !== i) }); }
  // Same pre-flight checks every export path has always used (fit, review
  // checklist, autosave) — returns false if export should not proceed.
  function exportPreflight() {
    const measurements = getLatestPageMeasurements();
    const fit = calcFit(jsa, measurements);
    if (fit.status === 'bad') {
      showToast('One task row is too large to print cleanly. Divide or shorten it before exporting.');
      setJsaStep('review');
      return false;
    }
    const missing = getReviewChecks(jsa, measurements).filter(check => !check.ok);
    if (missing.length) {
      const proceed = confirm(`The JSA still has ${missing.length} review item${missing.length === 1 ? '' : 's'}:\n\n${missing.map(item => `• ${item.label}`).join('\n')}\n\nPrint anyway?`);
      if (!proceed) {
        setJsaStep('review');
        return false;
      }
    }
    saveDraft(false);
    return true;
  }

  // STEP 1 — Generate. Primary export path (Phase 4B): a real, deterministic
  // multi-page PDF generated client-side from PdfExportRoot's captured
  // pages, instead of relying on browser print pagination — physical iPad
  // Safari repeatedly fragmented every logical page into two physical pages
  // across several structurally different CSS approaches, despite this
  // repo's automated tooling verifying clean geometry every time. This
  // sidesteps that failure mode entirely: Safari receives an
  // already-finished PDF file, not HTML it has to paginate itself.
  //
  // Deliberately does NOT call navigator.share() itself: generation
  // involves several awaited operations (per-page canvas capture, PDF
  // assembly) that can easily run long enough for the browser to consider
  // the original button tap's "transient user activation" expired, which
  // would make navigator.share() fail with NotAllowedError even though the
  // user very much did just tap a button moments ago. Instead this stores
  // the completed PDF in pdfExportState (phase: 'ready') and waits for a
  // SEPARATE, fresh tap on Share / Print PDF (shareGeneratedPdf below) —
  // that tap's own activation is what navigator.share() actually needs.
  async function exportPdf() {
    if (pdfExportState?.phase === 'generating') return; // guard against duplicate concurrent generation
    if (!exportPreflight()) return;
    const filename = `${buildExportName(jsa)}.pdf`;
    const fingerprint = fingerprintPaginationInput(jsa);
    try {
      setPdfExportState({ phase: 'generating', status: 'preparing' });
      const { blob, pageCount } = await generateJsaPdf(pdfExportPageRefsRef, (pageIndex, totalPages) => {
        setPdfExportState({ phase: 'generating', status: 'rendering', pageIndex, totalPages });
      });
      setPdfExportState({ phase: 'ready', blob, filename, pageCount, fingerprint, shareMessage: null });
    } catch (err) {
      console.error('[pdf export]', err);
      showToast(`PDF export failed (${err?.message || 'unknown error'}). Try Legacy Browser Print instead.`);
      setPdfExportState(null);
    }
  }

  // STEP 2 — Share / Print. Must be invoked directly from that button's own
  // onClick with no awaited work first (see shareGeneratedPdf's own
  // comment) — reuses the already-generated Blob, never regenerates. If
  // sharing is unsupported or fails for a reason other than the user
  // cancelling, the generated PDF is kept and Share/Download stay
  // available — a failed share must never discard completed work.
  function shareGeneratedPdfClick() {
    if (!pdfExportState || pdfExportState.phase !== 'ready') return;
    if (isPdfStale) return; // guarded in the UI too; double-checked here
    const file = new File([pdfExportState.blob], pdfExportState.filename, { type: 'application/pdf' });
    const result = shareGeneratedPdf(file);
    if (!result.ok) {
      setPdfExportState(prev => (prev && prev.phase === 'ready' ? { ...prev, shareMessage: result.reason } : prev));
      return;
    }
    result.promise
      .then(() => {
        setPdfExportState(prev => (prev && prev.phase === 'ready' ? { ...prev, shareMessage: null } : prev));
      })
      .catch(err => {
        if (err && err.name === 'AbortError') return; // user cancelled the share sheet -- normal, keep the PDF
        console.error('[pdf share]', err);
        setPdfExportState(prev => (prev && prev.phase === 'ready'
          ? { ...prev, shareMessage: `Sharing failed (${err?.name || err?.message || 'unknown error'}). Try again, or use Download PDF.` }
          : prev));
      });
  }

  function downloadGeneratedPdfClick() {
    if (!pdfExportState || pdfExportState.phase !== 'ready') return;
    if (isPdfStale) return;
    downloadGeneratedPdf(pdfExportState.blob, pdfExportState.filename);
    showToast(`PDF downloaded: ${pdfExportState.filename}`);
  }

  // Secondary/fallback path only — the original browser-print-dialog
  // implementation, kept available under "More Options" in case the
  // deterministic PDF pipeline fails on a given device (e.g. very old
  // Safari without File/Blob or canvas support). Not the primary workflow.
  function legacyBrowserPrint() {
    if (!exportPreflight()) return;
    const originalTitle = document.title;
    document.title = buildExportName(jsa);
    const restoreTitle = () => { document.title = originalTitle; };
    window.addEventListener('afterprint', restoreTitle, { once: true });
    setTimeout(() => {
      window.print();
      setTimeout(restoreTitle, 1500);
    }, 120);
  }

  const selectedTemplate = allTemplates.find(t => t.id === templateId);
  const draftLabel = savedDraft?.lastSavedAt ? `Draft saved ${nowNice(new Date(savedDraft.lastSavedAt))}` : 'No active saved draft';

  // One row descriptor per document type with an active draft — feeds both
  // the Drafts tab (see DraftsView above) and, once a document also wants a
  // Home "Continue Current Work" card, the same data. JSA and Incident wrap
  // their own existing state/handlers; the four new documents each reuse
  // their useDraftDocument instance directly.
  const draftEntries = [
    {
      id: 'jsa',
      savedDraft,
      draftTitle: savedDraft?.jobSite || savedDraft?.templateName || 'JSA Draft',
      metaLine: `Next: ${savedDraft ? nextStepHint(savedDraft) : ''} · ${savedDraft?.lastSavedAt ? `Last saved ${nowNice(new Date(savedDraft.lastSavedAt))}` : 'Saved on this device'}`,
      onOpen: loadSavedDraft,
      onDelete: () => { if (!savedDraft) return; if (!confirm('Delete this draft?')) return; setJsa(emptyJsa()); localStorage.removeItem(KEYS.draft); setSavedDraft(null); showToast('Draft deleted.'); },
    },
    {
      id: 'incident',
      savedDraft: savedIncidentDraft,
      draftTitle: savedIncidentDraft?.workplaceLocation || 'Untitled Incident Report',
      metaLine: `Next: ${savedIncidentDraft ? incidentNextStepHint(savedIncidentDraft) : ''} · ${savedIncidentDraft?.lastSavedAt ? `Last saved ${nowNice(new Date(savedIncidentDraft.lastSavedAt))}` : 'Saved on this device'}`,
      onOpen: loadSavedIncidentDraft,
      onDelete: () => { if (!savedIncidentDraft) return; if (!confirm('Delete this draft?')) return; resetIncidentToBlank(); showToast('Draft deleted.'); },
    },
    {
      id: 'disciplinary',
      savedDraft: disciplinary.savedDraft,
      draftTitle: disciplinary.savedDraft?.employeeName || 'Untitled Disciplinary Notice',
      metaLine: `Warning level: ${warningLevelLabel(disciplinary.savedDraft?.warningLevel) || 'Not selected'} · ${disciplinary.savedDraft?.lastSavedAt ? `Last saved ${nowNice(new Date(disciplinary.savedDraft.lastSavedAt))}` : 'Saved on this device'}`,
      onOpen: disciplinaryEntry.loadSavedDraft,
      onDelete: () => { if (!disciplinary.savedDraft) return; if (!confirm('Delete this draft?')) return; disciplinary.discard(); showToast('Draft deleted.'); },
    },
    {
      id: 'uncontrolledEvent',
      savedDraft: uncontrolledEvent.savedDraft,
      draftTitle: uncontrolledEvent.savedDraft?.workplaceLocation || 'Untitled Uncontrolled Event',
      metaLine: `${(uncontrolledEvent.savedDraft?.eventClassifications || []).join(', ') || 'Not classified'} · ${uncontrolledEvent.savedDraft?.lastSavedAt ? `Last saved ${nowNice(new Date(uncontrolledEvent.savedDraft.lastSavedAt))}` : 'Saved on this device'}`,
      onOpen: uncontrolledEventEntry.loadSavedDraft,
      onDelete: () => { if (!uncontrolledEvent.savedDraft) return; if (!confirm('Delete this draft?')) return; uncontrolledEvent.discard(); showToast('Draft deleted.'); },
    },
    {
      id: 'medicalEvent',
      savedDraft: medicalEvent.savedDraft,
      draftTitle: medicalEvent.savedDraft?.employeeName || 'Untitled Medical Event',
      metaLine: `${medicalEvent.savedDraft?.initialClassification ? 'Classified' : 'Not classified yet'} · ${medicalEvent.savedDraft?.lastSavedAt ? `Last saved ${nowNice(new Date(medicalEvent.savedDraft.lastSavedAt))}` : 'Saved on this device'}`,
      onOpen: medicalEventEntry.loadSavedDraft,
      onDelete: () => { if (!medicalEvent.savedDraft) return; if (!confirm('Delete this draft?')) return; medicalEvent.discard(); showToast('Draft deleted.'); },
    },
    {
      id: 'separation',
      savedDraft: separation.savedDraft,
      draftTitle: separation.savedDraft?.employeeName || 'Untitled Separation',
      metaLine: `${separation.savedDraft?.separationReason || 'Reason not selected'} · ${separation.savedDraft?.lastSavedAt ? `Last saved ${nowNice(new Date(separation.savedDraft.lastSavedAt))}` : 'Saved on this device'}`,
      onOpen: separationEntry.loadSavedDraft,
      onDelete: () => { if (!separation.savedDraft) return; if (!confirm('Delete this draft?')) return; separation.discard(); showToast('Draft deleted.'); },
    },
  ];

  // One descriptor per available document type for Home — start handler,
  // and the in-progress draft's own progress when there is one.
  //
  // Home used to give JSA and Incident full hero cards and demote the other
  // four to small rows under "More Documents". That ordering was build order,
  // not field priority: a superintendent documenting a medical event scrolled
  // past two heroes and a workspace row to reach it, and their half-finished
  // Medical Event draft appeared only as grey subtitle text while a JSA draft
  // got its own card with a progress bar. Every document type reads from this
  // one list now, so they are all equally findable and a draft is a draft
  // whatever kind of document it belongs to.
  const homeStartHandlers = {
    /* JSA keeps going straight to a blank form, as Home has always done —
       its tile carries the separate Templates button for the other path.
       Adding a picker step to the most-used document to make the grid
       symmetrical would be a worse trade than the asymmetry. */
    jsa: requestStartBlank,
    incident: requestStartIncidentBlank,
    disciplinary: disciplinaryEntry.requestStartBlank,
    uncontrolledEvent: uncontrolledEventEntry.requestStartBlank,
    medicalEvent: medicalEventEntry.requestStartBlank,
    separation: separationEntry.requestStartBlank,
  };
  const homeProgress = {
    jsa: [draftStepProgress, nextStepHint],
    incident: [incidentStepProgress, incidentNextStepHint],
    disciplinary: [disciplinaryStepProgress, disciplinaryNextStepHint],
    uncontrolledEvent: [uncontrolledEventStepProgress, uncontrolledEventNextStepHint],
    medicalEvent: [medicalEventStepProgress, medicalEventNextStepHint],
    separation: [separationStepProgress, separationNextStepHint],
  };
  const homeDocEntries = DOCUMENT_REGISTRY
    .filter(d => d.status === 'available' && d.id in homeStartHandlers)
    .map(d => {
      const entry = draftEntries.find(e => e.id === d.id);
      const model = entry?.savedDraft;
      const [progressOf, hintOf] = homeProgress[d.id];
      return {
        id: d.id,
        shortTitle: d.shortTitle,
        description: d.description,
        /* "Start Incident Report" / "Continue Incident Report" are Incident's
           own established wording, so they come from incidentCopy rather than
           being re-derived and left to drift. Every other type reads the same
           way off its registry short title. */
        startLabel: d.id === 'incident' ? incidentCopy.home.startButton : `Start ${d.shortTitle}`,
        continueLabel: d.id === 'incident' ? incidentCopy.home.continueButton : `Continue ${d.shortTitle}`,
        onStart: homeStartHandlers[d.id],
        onBrowseTemplates: d.supportsTemplates ? () => setTab('templates') : null,
        draft: model ? {
          title: entry.draftTitle,
          nextStep: hintOf(model),
          progress: progressOf(model),
          savedLabel: model.lastSavedAt ? nowNice(new Date(model.lastSavedAt)) : 'on this device',
          savedAt: model.lastSavedAt ? new Date(model.lastSavedAt).getTime() : 0,
          onOpen: entry.onOpen,
        } : null,
      };
    });

  // Phone bottom nav stands in for the sidebar only at the tab level — inside
  // a document flow the workflow's own header/back button and sticky action
  // bar already own wayfinding, so it's not rendered there (see .mobileBottomNav).
  // Driven by DOCUMENT_REGISTRY (plus JSA's own separate "-start" picker
  // screen) so a newly-registered document is automatically treated as a
  // document flow without another edit here.
  const isDocFlow = activeDoc === 'jsa-start' || DOCUMENT_REGISTRY.some(d => d.id === activeDoc);

  return (
    <>
      <div className="appShell">
        <aside className={`sidebar${isDocFlow && activeDoc !== 'jsa-start' ? ' builderActive' : ''}`}>
          <div className="sidebarBrand">
            <span className="sidebarBrandName">{APP_NAME}</span>
            <span className="sidebarBrandSub">{APP_SUB}</span>
          </div>

          <nav className="sidebarNav">
            <button className={`sidebarNavItem${tab === 'home' ? ' active' : ''}`} onClick={goHome}>
              <IconHome className="sidebarNavIcon" /><span className="sidebarNavLabel">Home</span>
            </button>
            <button className={`sidebarNavItem${tab === 'documents' ? ' active' : ''}`} onClick={goDocs}>
              <IconDocuments className="sidebarNavIcon" /><span className="sidebarNavLabel">Documents</span>
            </button>
            <button className={`sidebarNavItem${tab === 'drafts' ? ' active' : ''}`} onClick={() => setTab('drafts')}>
              <IconDrafts className="sidebarNavIcon" /><span className="sidebarNavLabel">Drafts</span>
            </button>
            <button className={`sidebarNavItem${tab === 'templates' ? ' active' : ''}`} onClick={() => setTab('templates')}>
              <IconTemplates className="sidebarNavIcon" /><span className="sidebarNavLabel">Templates</span>
            </button>
          </nav>

          <div className="sidebarBottom">
            <button className={`sidebarNavItem${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
              <IconSettings className="sidebarNavIcon" /><span className="sidebarNavLabel">Settings</span>
            </button>
          </div>
        </aside>

        <main className={`page${isDocFlow ? '' : ' pageWithBottomNav'}`}>
          {tab === 'home' && (
            <HomeView customTemplates={customTemplates} setTab={setTab} docEntries={homeDocEntries} />
          )}
          {tab === 'documents' && !activeDoc && (
            <DocCenterView startHandlers={{
              jsa: goJsaStart,
              incident: requestStartIncidentBlank,
              disciplinary: disciplinaryEntry.requestStartBlank,
              uncontrolledEvent: uncontrolledEventEntry.requestStartBlank,
              medicalEvent: medicalEventEntry.requestStartBlank,
              separation: separationEntry.requestStartBlank,
            }}
            onImportFile={importDraftFile}
            />
          )}
          {tab === 'documents' && activeDoc === 'jsa-start' && (
            <JsaStartView allTemplates={allTemplates} selectedTemplate={selectedTemplate} templateId={templateId} setTemplateId={setTemplateId} loadTemplate={requestLoadTemplate} loadSavedDraft={loadSavedDraft} startBlank={requestStartBlank} repeatLastJsa={requestRepeatLastJsa} savedDraft={savedDraft} />
          )}
          {tab === 'documents' && activeDoc === 'jsa' && (
            <JsaWorkflow
              jsa={jsa} upd={upd} jsaStep={jsaStep} setJsaStep={setJsaStep}
              goDocs={goDocs} goJsaStart={goJsaStart}
              allTemplates={allTemplates} templateId={templateId} setTemplateId={setTemplateId} selectedTemplate={selectedTemplate} loadTemplate={loadTemplate}
              saveName={saveName} setSaveName={setSaveName} saveTemplate={saveTemplate} updateTemplate={updateTemplate}
              updRow={updRow} removeRow={removeRow}
              clearDraft={clearDraft} saveDraft={saveDraft} markReady={markReady} exportPdf={exportPdf}
              legacyBrowserPrint={legacyBrowserPrint} pdfExportState={pdfExportState} isPdfStale={isPdfStale}
              shareGeneratedPdfClick={shareGeneratedPdfClick} downloadGeneratedPdfClick={downloadGeneratedPdfClick}
              savedDraft={savedDraft} settings={settings} saveStatus={saveStatus}
            />
          )}
          {tab === 'documents' && activeDoc === 'incident' && (
            <IncidentWorkflow
              incident={incident} setIncident={setIncident} step={incidentStep} setStep={setIncidentStep}
              goDocs={goDocs} saveStatus={incidentSaveStatusLabel} saveStatusState={incidentSaveStatus} onSaveNow={saveIncidentNow}
              pdfExportState={incidentPdfExportState} isPdfStale={isIncidentPdfStale}
              onGeneratePdf={exportIncidentPdf} onDownload={downloadIncidentPdfClick}
              onMarkReady={markIncidentReady} onMarkIncomplete={markIncidentIncomplete} onStartNew={startNewIncidentReport} showToast={showToast}
            />
          )}
          {tab === 'documents' && activeDoc === 'disciplinary' && (
            <DisciplinaryWorkflow
              model={disciplinary.model} upd={disciplinary.upd} step={disciplinary.step} setStep={disciplinary.setStep}
              goDocs={goDocs} saveStatus={saveStatusLabel(disciplinary.saveStatus, disciplinary.model.lastSavedAt)}
              saveStatusState={disciplinary.saveStatus} onSaveNow={disciplinary.saveNow}
              pdfExportState={disciplinaryPdf.pdfExportState} isPdfStale={disciplinaryPdf.isPdfStale}
              onGeneratePdf={disciplinaryPdf.generate} onDownload={disciplinaryPdf.downloadClick}
              onMarkReady={markDisciplinaryReady} onMarkIncomplete={markDisciplinaryIncomplete} onStartNew={startNewDisciplinary}
            />
          )}
          {tab === 'documents' && activeDoc === 'uncontrolledEvent' && (
            <UncontrolledEventWorkflow
              model={uncontrolledEvent.model} upd={uncontrolledEvent.upd} step={uncontrolledEvent.step} setStep={uncontrolledEvent.setStep}
              goDocs={goDocs} saveStatus={saveStatusLabel(uncontrolledEvent.saveStatus, uncontrolledEvent.model.lastSavedAt)}
              saveStatusState={uncontrolledEvent.saveStatus} onSaveNow={uncontrolledEvent.saveNow}
              pdfExportState={uncontrolledEventPdf.pdfExportState} isPdfStale={uncontrolledEventPdf.isPdfStale}
              onGeneratePdf={uncontrolledEventPdf.generate} onDownload={uncontrolledEventPdf.downloadClick}
              onMarkReady={markUncontrolledEventReady} onMarkIncomplete={markUncontrolledEventIncomplete} onStartNew={startNewUncontrolledEvent}
            />
          )}
          {tab === 'documents' && activeDoc === 'medicalEvent' && (
            <MedicalEventWorkflow
              model={medicalEvent.model} upd={medicalEvent.upd} step={medicalEvent.step} setStep={medicalEvent.setStep}
              goDocs={goDocs} saveStatus={saveStatusLabel(medicalEvent.saveStatus, medicalEvent.model.lastSavedAt)}
              saveStatusState={medicalEvent.saveStatus} onSaveNow={medicalEvent.saveNow}
              pdfExportState={medicalEventPdf.pdfExportState} isPdfStale={medicalEventPdf.isPdfStale}
              onGeneratePdf={medicalEventPdf.generate} onDownload={medicalEventPdf.downloadClick}
              onMarkReady={markMedicalEventReady} onMarkIncomplete={markMedicalEventIncomplete} onStartNew={startNewMedicalEvent}
            />
          )}
          {tab === 'documents' && activeDoc === 'separation' && (
            <SeparationWorkflow
              model={separation.model} upd={separation.upd} step={separation.step} setStep={separation.setStep}
              goDocs={goDocs} saveStatus={saveStatusLabel(separation.saveStatus, separation.model.lastSavedAt)}
              saveStatusState={separation.saveStatus} onSaveNow={separation.saveNow}
              pdfExportState={separationPdf.pdfExportState} isPdfStale={separationPdf.isPdfStale}
              onGeneratePdf={separationPdf.generate} onDownload={separationPdf.downloadClick}
              onMarkReady={markSeparationReady} onMarkIncomplete={markSeparationIncomplete} onStartNew={startNewSeparation}
            />
          )}
          {tab === 'drafts' && <DraftsView entries={draftEntries} goDocs={goDocs} />}
          {tab === 'templates' && <TemplatesView allTemplates={allTemplates} customTemplates={customTemplates} loadTemplate={requestLoadTemplate} deleteTemplate={deleteTemplate} startBlank={requestStartBlank} shareTemplate={shareTemplate} importTemplateFile={importTemplateFile} />}
          {tab === 'settings' && <SettingsView settings={settings} setSettings={setSettings} />}
        </main>
      </div>

      {!isDocFlow && (
        <MobileBottomNav tab={tab} goHome={goHome} goDocs={goDocs} setTab={setTab} />
      )}

      {confirmReplace && (
        <ConfirmReplaceDialog
          templateName={confirmReplace.action === 'template' ? allTemplates.find(t => t.id === confirmReplace.templateId)?.name : null}
          isImport={confirmReplace.action === 'import'}
          isRepeat={confirmReplace.action === 'repeat'}
          onCancel={confirmReplaceCancel}
          onContinue={confirmReplaceContinue}
        />
      )}

      <PaginationMeasureRig jsa={jsa} />
      <PrintableJsa jsa={jsa} />
      <PdfExportRoot jsa={jsa} plan={pdfExportPlan} pageRefsRef={pdfExportPageRefsRef} />
      <IncidentPdfExportRoot incident={incident} pageRefsRef={incidentPdfPageRefsRef} />
      {/* The four Superintendent documents draw their PDFs directly
          (renderPdf passed to usePdfExport below) — no hidden export DOM to
          mount here. JSA and Incident keep the screenshot pipeline above,
          which is why they still need theirs. */}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/* ── Mobile bottom navigation ──
   Phone-only replacement for the sidebar (see .mobileBottomNav / .sidebar in
   styles.css — the sidebar is hidden and this is shown below the same
   680px breakpoint already used elsewhere in the stylesheet). Same five
   destinations and the same handlers as the sidebar nav, so tab/activeDoc
   state and every route stay identical — this only changes which chrome
   renders them on a phone. Not rendered while a document flow is open;
   App only mounts it when !isDocFlow. */
function MobileBottomNav({ tab, goHome, goDocs, setTab }) {
  return (
    <nav className="mobileBottomNav" aria-label="Primary">
      <button className={`mobileNavItem${tab === 'home' ? ' active' : ''}`} onClick={goHome}>
        <IconHome className="mobileNavIcon" /><span>Home</span>
      </button>
      <button className={`mobileNavItem${tab === 'documents' ? ' active' : ''}`} onClick={goDocs}>
        <IconDocuments className="mobileNavIcon" /><span>Documents</span>
      </button>
      <button className={`mobileNavItem${tab === 'drafts' ? ' active' : ''}`} onClick={() => setTab('drafts')}>
        <IconDrafts className="mobileNavIcon" /><span>Drafts</span>
      </button>
      <button className={`mobileNavItem${tab === 'templates' ? ' active' : ''}`} onClick={() => setTab('templates')}>
        <IconTemplates className="mobileNavIcon" /><span>Templates</span>
      </button>
      <button className={`mobileNavItem${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
        <IconSettings className="mobileNavIcon" /><span>Settings</span>
      </button>
    </nav>
  );
}

/* Per-document-type marks for Home's start grid. Six identical page icons
   would defeat the point of the grid — on a phone the picture is what a user
   actually scans for, before the words resolve. */
const DOC_ICONS = {
  jsa: IconDocuments,
  incident: IconIncident,
  uncontrolledEvent: IconWeather,
  medicalEvent: IconMedical,
  disciplinary: IconWarningNote,
  separation: IconSeparation,
};

/* "01"-"06" — part of the document's name per the C2 spec (tile, header
   eyebrow, and draft card all show it), derived from DOCUMENT_REGISTRY's
   own order rather than stored anywhere, so it can't drift out of sync. */
function docNumber(id) {
  const idx = DOCUMENT_REGISTRY.findIndex(d => d.id === id);
  return idx === -1 ? '' : String(idx + 1).padStart(2, '0');
}

/* ── Home view ──
   Two questions, in the order a field user actually asks them: "let me finish
   what I started" and "let me start the right document". Both are answered
   across ALL six document types on equal footing — see homeDocEntries in
   App() for why that ordering changed — followed by the Workspace shortcuts. */
function HomeView({ customTemplates, setTab, docEntries }) {
  const [query, setQuery] = useState('');
  const inProgress = docEntries.filter(e => e.draft);
  const q = query.trim().toLowerCase();
  const matching = q ? inProgress.filter(e => e.draft.title.toLowerCase().includes(q)) : inProgress;
  const sorted = [...matching].sort((a, b) => b.draft.savedAt - a.draft.savedAt);
  const MAX_VISIBLE = 4;
  const visible = q ? sorted : sorted.slice(0, MAX_VISIBLE);
  const overflowCount = q ? 0 : Math.max(0, sorted.length - MAX_VISIBLE);

  return (
    <div className="homeLayout">
      <header className="homeHeader">
        <div className="homeHeaderText">
          <h1>Safety Documentation Center</h1>
          <p>Create, manage, review, and export field safety documents.</p>
        </div>
        <label className="homeSearch">
          <IconSearch className="homeSearchIcon" />
          <input
            type="search"
            className="homeSearchInput"
            placeholder="Search job site or person"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search in-progress documents by job site or person"
          />
        </label>
      </header>

      <section className="homeSection">
        <span className="homeSectionEyebrow">Not finished &middot; {inProgress.length}</span>
        {inProgress.length === 0 ? (
          <div className="homeEmptyRow">
            <span className="homeEmptyCheck" aria-hidden="true">&#10003;</span>
            <div className="homeEmptyText">
              <strong>Nothing unfinished</strong>
              <span>Everything you started is signed and downloaded.</span>
            </div>
          </div>
        ) : matching.length === 0 ? (
          <div className="homeEmptyRow">
            <div className="homeEmptyText">
              <strong>No matches</strong>
              <span>Nothing unfinished matches &ldquo;{query}&rdquo;.</span>
            </div>
          </div>
        ) : (
          <>
            <div className="continueGrid">
              {visible.map(e => {
                const { progress } = e.draft;
                const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
                const Icon = DOC_ICONS[e.id] || IconDocuments;
                return (
                  <section className="continueCard" key={e.id}>
                    <div className="continueCardBody">
                      <span className="continueCardType"><Icon className="continueCardIcon" />{docNumber(e.id)} &middot; {e.shortTitle}</span>
                      <strong className="continueCardTitle">{e.draft.title}</strong>
                      <span className="continueCardMeta">{e.draft.nextStep} &middot; saved {e.draft.savedLabel}</span>
                      <span className="continueWorkProgress">
                        <span className="continueWorkProgressTrack"><span className="continueWorkProgressFill" style={{ width: `${pct}%` }} /></span>
                        <span>{progress.done} of {progress.total}</span>
                      </span>
                    </div>
                    <button className="btn primary continueCardBtn" onClick={e.draft.onOpen}>{e.continueLabel}</button>
                  </section>
                );
              })}
            </div>
            {overflowCount > 0 && (
              <button type="button" className="homeSeeAll" onClick={() => setTab('drafts')}>
                See all {sorted.length} &rsaquo;
              </button>
            )}
          </>
        )}
      </section>

      <section className="homeSection">
        <span className="homeSectionEyebrow">Start a Document</span>
        <div className="startDocGrid">
          {docEntries.map(e => {
            const Icon = DOC_ICONS[e.id] || IconDocuments;
            return (
              <section className="startDocTile" key={e.id}>
                <div className="startDocTileHead">
                  <Icon className="startDocTileIcon" />
                  <span className="startDocTileNum">{docNumber(e.id)}</span>
                </div>
                <h2>{e.shortTitle}</h2>
                <p>{e.description}</p>
                {e.onBrowseTemplates && (
                  <button type="button" className="btn ghost sm startDocTileTemplates" onClick={e.onBrowseTemplates}>
                    Templates{customTemplates.length > 0 ? ` (${customTemplates.length})` : ''}
                  </button>
                )}
                <button type="button" className="startDocTileStart" onClick={e.onStart}>
                  {e.startLabel}<span aria-hidden="true">&rsaquo;</span>
                </button>
              </section>
            );
          })}
        </div>
      </section>

      <section className="homeSection">
        <span className="homeSectionEyebrow">Workspace</span>
        <div className="workspaceAccessGrid">
          <button className="accessRow" onClick={() => setTab('documents')}>
            <IconDocuments className="accessRowIcon" />
            <span className="accessRowText"><strong>Documents</strong><small>Every document type, with details</small></span>
            <IconChevronRight className="accessRowChevron" />
          </button>
          <button className="accessRow" onClick={() => setTab('drafts')}>
            <IconDrafts className="accessRowIcon" />
            <span className="accessRowText"><strong>Drafts</strong><small>Work in progress on this device</small></span>
            <IconChevronRight className="accessRowChevron" />
          </button>
          <button className="accessRow" onClick={() => setTab('templates')}>
            <IconTemplates className="accessRowIcon" />
            <span className="accessRowText"><strong>Templates</strong><small>{customTemplates.length > 0 ? `${customTemplates.length} saved` : 'Reusable starting points'}</small></span>
            <IconChevronRight className="accessRowChevron" />
          </button>
        </div>
      </section>

    </div>
  );
}

/* ── Document center ──
   Renders the "Available Now" section from DOCUMENT_REGISTRY (see
   src/documents/registry.js) grouped by category, instead of one hardcoded
   .listItem per document type — adding a new document to the registry is
   enough for it to appear here with no further Documents-tab changes.
   `startHandlers` maps registry id -> the App()-level function that begins
   that document (JSA and Incident keep their own existing entry-point
   functions; the four new documents each get a requestStart* function from
   their own useDraftDocument instance). */
function DocCenterView({ startHandlers, onImportFile }) {
  const grouped = DOCUMENT_CATEGORY_ORDER.map(catId => ({
    catId,
    label: DOCUMENT_CATEGORIES[catId],
    docs: DOCUMENT_REGISTRY.filter(d => d.status === 'available' && d.category === catId),
  })).filter(g => g.docs.length);
  const importInputRef = useRef(null);
  function onImportInputChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onImportFile(file);
  }

  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">Documents</div>
        <h2>Documents</h2>
        <p>Start or open a document type.</p>
      </div>

      <section className="homeSection">
        <div className="listItem">
          <div className="itemInfo">
            <strong>Import a Draft</strong>
            <p>Received a draft file from someone in the field? Import it here to keep working on it — no need to retype anything.</p>
          </div>
          <div className="itemActions">
            <input ref={importInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportInputChange} />
            <button className="btn secondary sm" onClick={() => importInputRef.current?.click()}>Import Draft</button>
          </div>
        </div>
      </section>

      {grouped.map(g => (
        <section className="homeSection" key={g.catId}>
          <span className="homeSectionEyebrow">{g.label}</span>
          {g.docs.map(doc => (
            <div className="listItem" key={doc.id}>
              <div className="itemInfo">
                <strong>{doc.title}</strong>
                <p>{doc.description}</p>
              </div>
              <div className="itemActions">
                <span className="badge avail">Available</span>
                <button className="btn secondary sm" onClick={startHandlers[doc.id]}>Start</button>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ── JSA start / launcher ── */
function JsaStartView({ allTemplates, selectedTemplate, templateId, setTemplateId, loadTemplate, loadSavedDraft, startBlank, repeatLastJsa, savedDraft }) {
  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">Job Safety Analysis</div>
        <h2>Start a JSA</h2>
        <p>Choose how you want to begin. Templates and drafts are selected here, before the builder opens.</p>
      </div>
      <div className="card">
        <div className="cardHeader"><h3>Start Options</h3></div>
        <div className="cardBody">
          <div className="launchGrid">
            <button className="launchChoice featured" onClick={startBlank}>
              <strong>Start Blank</strong>
              <p>Open a clean JSA form. Good for new jobs or when you want to build a fresh template from scratch.</p>
            </button>
            {/* For a job that runs the same day-to-day -- same tasks,
                hazards, controls -- without going through the
                save/name/pick-a-template flow below (Fonzo, 2026-08-29:
                "the templates are just for different scopes of work...
                if the JSA is not changing"). Sourced from the last saved
                JSA, not a saved template, so it needs nothing set up ahead
                of time -- reuses the exact same day-reset makeTodayFromTemplate
                applies when loading a real template. */}
            <button className="launchChoice" onClick={repeatLastJsa} disabled={!savedDraft} style={{ opacity: savedDraft ? 1 : .65 }}>
              <strong>Repeat Last JSA</strong>
              <p>{savedDraft ? 'Same job info, tasks, hazards, and controls as the last JSA — date, tailgate topic, and signatures reset for today.' : 'No previous JSA found on this device.'}</p>
            </button>
            <button className="launchChoice" onClick={loadSavedDraft} style={{ opacity: savedDraft ? 1 : .65 }}>
              <strong>Continue Draft</strong>
              <p>{savedDraft?.lastSavedAt ? `Draft available — saved ${nowNice(new Date(savedDraft.lastSavedAt))}` : 'No draft found on this device.'}</p>
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="cardHeader">
          <h3>Load a Template</h3>
          <p>Templates save recurring job info, hazards, and controls. Daily fields reset automatically when loaded.</p>
        </div>
        <div className="cardBody">
          <div className="templateLauncher">
            <label className="field">
              <span>Choose Template</span>
              <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                {allTemplates.map(t => <option key={t.id} value={t.id}>{t.source === 'custom' ? 'Custom: ' : ''}{t.name}</option>)}
              </select>
            </label>
            <button className="btn secondary" onClick={() => loadTemplate(templateId)}>Load Template</button>
            {selectedTemplate?.description && <p className="helperText templateLauncher">{selectedTemplate.description}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared across every "Print / Save PDF" button location. Only meaningful
// while phase 'generating' — StepExport and the compact locations below
// handle the 'ready' phase (success state) with their own labels/actions,
// since that phase needs two distinct actions (Share/Print, Download), not
// one busy-label string.
function pdfExportStatusLabel(state) {
  if (!state || state.phase !== 'generating') return null;
  if (state.status === 'preparing') return 'Preparing PDF…';
  if (state.status === 'rendering') return `Rendering page ${state.pageIndex} of ${state.totalPages}…`;
  if (state.status === 'finalizing') return 'Finalizing PDF…';
  return 'Working…';
}

// Compact locations (sticky action bar, Live Preview header) get a single
// "smart" button rather than the full ready-panel StepExport shows — space
// is tight there, and Export is one tap away for the fuller experience.
// Download (not Share) is the one primary action app-wide now, and unlike
// navigator.share() it has no "fresh user activation" timing requirement,
// so this can safely reuse the same already-generated PDF regardless of
// how long ago generation finished.
function compactExportLabel(pdfExportState, isPdfStale) {
  const generating = pdfExportStatusLabel(pdfExportState);
  if (generating) return generating;
  if (pdfExportState?.phase === 'ready') return isPdfStale ? 'Update Document' : 'Download Document';
  return 'Create Document';
}
function compactExportAction(pdfExportState, isPdfStale, exportPdf, downloadGeneratedPdfClick) {
  if (pdfExportState?.phase === 'ready' && !isPdfStale) return downloadGeneratedPdfClick;
  return exportPdf;
}

/* ── Sticky workflow action bar (touch devices): one Back/Next location,
   quiet save status, reachable above the keyboard and Safari's bottom UI. ── */
function StickyActionBar({ idx, steps, prev, next, exportPdf, pdfExportState, isPdfStale, downloadGeneratedPdfClick, showPreview, setShowPreview, saveStatus }) {
  const isFirst = idx === 0;
  const isLast = idx === steps.length - 1;
  const nextStep = steps[idx + 1];
  const statusText = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : '';
  const isGenerating = pdfExportState?.phase === 'generating';
  return (
    <div className="stickyActionBar">
      <div className="stickyActionSide stickyActionLeft">
        {!isFirst && <button className="btn ghost sm" onClick={prev} disabled={isGenerating}>Back</button>}
      </div>
      <div className={`stickyActionStatus${saveStatus === 'error' ? ' error' : ''}`} aria-live="polite">{statusText}</div>
      <div className="stickyActionSide stickyActionRight">
        {!isLast && (
          <button className="btn outline sm" onClick={() => setShowPreview(v => !v)}>
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>
        )}
        {!isLast && nextStep && <button className="btn primary sm" onClick={next}>{nextStep.id === 'signatures' ? 'Ready for Crew to Sign' : `Next: ${nextStep.label}`}</button>}
        {isLast && (
          <button
            className="btn primary sm"
            onClick={compactExportAction(pdfExportState, isPdfStale, exportPdf, downloadGeneratedPdfClick)}
            disabled={isGenerating}
            aria-busy={isGenerating}
          >
            {compactExportLabel(pdfExportState, isPdfStale)}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── JSA Workflow ── */
function JsaWorkflow({ jsa, upd, jsaStep, setJsaStep, goDocs, goJsaStart, allTemplates, templateId, setTemplateId, selectedTemplate, loadTemplate, saveName, setSaveName, saveTemplate, updateTemplate, updRow, removeRow, clearDraft, saveDraft, markReady, exportPdf, legacyBrowserPrint, pdfExportState, isPdfStale, shareGeneratedPdfClick, downloadGeneratedPdfClick, savedDraft, settings, saveStatus }) {
  const plan = useJsaPagePlan(jsa);
  const fit = calcFitFromPlan(plan);
  const measurements = usePageMeasurements();
  const checks = useMemo(() => getReviewChecks(jsa, measurements), [jsa, measurements]);
  const idx = STEPS.findIndex(s => s.id === jsaStep);
  const shellRef = useRef(null);
  const shellWidth = useElementWidth(shellRef);
  const isTouchPrimary = useIsTouchPrimary();
  const canSideBySide = !isTouchPrimary && shellWidth >= 1000;
  const [showPreview, setShowPreview] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
  const debugLayout = useDebugLayoutFlag();
  const layoutMode = canSideBySide ? 'desktop-side-by-side' : (isTouchPrimary ? 'touch-stacked' : 'desktop-stacked-narrow');
  // Both the content-review checkpoint (before signing) and the final export
  // step always show the real printed page(s) — "What will print" is not
  // optional there the way the mid-workflow Preview toggle is; only earlier
  // steps respect the user's showPreview toggle.
  const isReviewStep = jsaStep === 'review' || jsaStep === 'export';
  const previewOpen = isReviewStep ? true : showPreview;
  // Whether the side-by-side preview column is actually rendering right now —
  // both canSideBySide (width/touch capability) and previewOpen (the existing
  // toggle) are pre-existing derived values; this only combines them so the
  // builder can expand to use the full laptop width whenever a preview isn't
  // actually occupying the right column, instead of always reserving that
  // space just because the viewport is technically wide enough for it.
  const showSideBySide = canSideBySide && previewOpen;

  function prev() { if (idx > 0) setJsaStep(STEPS[idx - 1].id); }
  // Leaving the Review step (moving on to Signatures) is the one advance
  // that isn't a free walk to the next tab -- it's the "ready for the crew
  // to sign?" moment, so it gets the same fit/checklist confirm exportPdf's
  // own preflight already uses rather than a silent, unquestioned Next.
  function next() {
    if (idx >= STEPS.length - 1) return;
    if (jsaStep === 'review') {
      const missing = checks.filter(c => !c.ok);
      if (missing.length) {
        const proceed = confirm(`This JSA still has ${missing.length} item${missing.length === 1 ? '' : 's'} to fix:\n\n${missing.map(c => `• ${c.label}`).join('\n')}\n\nLet the crew sign anyway?`);
        if (!proceed) return;
      }
      // "Ready for Crew to Sign" lands on the Signatures step and lets the
      // Kiosk / Print & Sign in Pen toggle there be the actual prompt
      // (Fonzo, 2026-09-01: it was silently skipping straight into kiosk
      // mode because signInMode defaults to 'kiosk' on every new JSA, so
      // nobody ever saw a real choice -- auto-opening the kiosk here made
      // that default look like the only option instead of a pre-selected
      // one they could still change).
      setJsaStep('signatures');
      return;
    }
    setJsaStep(STEPS[idx + 1].id);
  }
  // Kiosk's own "Done Signing" already auto-adds the 20 blank late/visitor
  // lines (CrewSignInKiosk.jsx) -- closing it also moves straight on to
  // Finish & Export, since there's nothing left to configure on Signatures.
  function finishSigning() {
    setKioskOpen(false);
    setJsaStep('export');
  }
  // Signatures/Export are only reachable once Job/Meeting/Work are actually
  // filled in -- otherwise a crew could sign a JSA with no content on it via
  // a direct StepNav jump (sequential Next already can't skip steps, but the
  // sidebar could before this).
  const contentReady = ['job', 'meeting', 'work'].every(s => stepStatus(jsa, s) === 'complete');
  // Signatures/Export show as visually locked (not "Done") in the step nav
  // whenever they're not actually reachable yet -- a step whose own checks
  // happen to already pass via a default value (signature line count
  // defaults to 30) used to read "Done" even though clicking it just got
  // redirected away, which read backwards in the field.
  const lockedIds = contentReady ? [] : ['signatures', 'export'];
  function guardedJump(id) {
    if ((id === 'signatures' || id === 'export') && !contentReady) {
      const blocker = STEPS.find(s => ['job', 'meeting', 'work'].includes(s.id) && stepStatus(jsa, s.id) !== 'complete');
      setJsaStep(blocker ? blocker.id : 'job');
      return;
    }
    setJsaStep(id);
  }

  const previewPanel = (
    <div className="card previewPanel">
      <div className="previewPanelHeader">
        <div>
          <strong>{isReviewStep ? 'What Will Print' : 'Live Preview'}</strong>
          <span>{isReviewStep ? 'The real printed page, scaled to fit' : 'Scaled preview of the printed layout'}</span>
        </div>
        <button
          className="btn sm outline"
          onClick={compactExportAction(pdfExportState, isPdfStale, exportPdf, downloadGeneratedPdfClick)}
          disabled={pdfExportState?.phase === 'generating'}
          aria-busy={pdfExportState?.phase === 'generating'}
        >
          {compactExportLabel(pdfExportState, isPdfStale)}
        </button>
      </div>
      <JsaPreview jsa={jsa} />
    </div>
  );

  return (
    <>
      {kioskOpen && <CrewSignInKiosk jsa={jsa} upd={upd} onExit={finishSigning} />}
      <div className="builderHeader">
        <div className="builderHeaderTitleRow">
          <div className="builderHeaderTitleBlock">
            <span className="builderHeaderKicker">Job Safety Analysis</span>
            <h1 className="builderHeaderTitle">{jsa.jobSite || jsa.templateName || 'Untitled JSA'}</h1>
          </div>
          <button className="backBtn" onClick={goJsaStart}>&larr; Start Options</button>
        </div>
        <div className="builderHeaderTop">
          <div className="builderHeaderBadges">
            <span className={`badge ${jsa.status}`}>{jsa.status === 'ready' ? 'Ready to Export' : 'Draft'}</span>
            <span className={`fitBadge ${fit.status}`}>{fit.label}</span>
            <span className="builderHeaderSaved">{jsa.lastSavedAt ? `Saved ${nowNice(new Date(jsa.lastSavedAt))}` : 'Not saved yet'}</span>
          </div>
          {!isTouchPrimary && !isReviewStep && (
            <button className="btn sm outline" onClick={() => setShowPreview(v => !v)}>
              {showPreview ? 'Hide Preview' : 'Preview JSA'}
            </button>
          )}
        </div>
      </div>

      <StepNav steps={STEPS} activeStepId={jsaStep} checks={checks} onJump={guardedJump} lockedIds={lockedIds} />
      <div className={`workflowShell${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
        <div className="workflowLeft">
          {jsaStep === 'job' && <StepJob jsa={jsa} upd={upd} prev={prev} next={next} />}
          {jsaStep === 'meeting' && <StepMeeting jsa={jsa} upd={upd} prev={prev} next={next} />}
          {jsaStep === 'work' && <StepWork jsa={jsa} upd={upd} updRow={updRow} removeRow={removeRow} customQuick={settings.customQuick || { task: [], hazard: [], control: [] }} prev={prev} next={next} />}
          {jsaStep === 'review' && <StepContentReview jsa={jsa} upd={upd} checks={checks} plan={plan} fit={fit} prev={prev} next={next} setJsaStep={setJsaStep} />}
          {jsaStep === 'signatures' && <StepSignatures jsa={jsa} upd={upd} prev={prev} next={next} onOpenKiosk={() => setKioskOpen(true)} />}
          {jsaStep === 'export' && <StepExport jsa={jsa} saveName={saveName} setSaveName={setSaveName} saveTemplate={saveTemplate} updateTemplate={updateTemplate} saveDraft={saveDraft} markReady={markReady} exportPdf={exportPdf} legacyBrowserPrint={legacyBrowserPrint} pdfExportState={pdfExportState} isPdfStale={isPdfStale} downloadGeneratedPdfClick={downloadGeneratedPdfClick} clearDraft={clearDraft} prev={prev} next={next} />}

          {!canSideBySide && previewOpen && previewPanel}
        </div>

        {showSideBySide && (
          <div className="workflowRight">
            {previewPanel}
          </div>
        )}
      </div>

      {debugLayout && (
        <LayoutDebugPanel
          containerRef={shellRef}
          layoutMode={layoutMode}
          previewMode={layoutMode}
          stepperMode="unified segmented rail (label density adapts via container query)"
          jobPairMode={isTouchPrimary ? 'forced-stack (date/time); container-query (client/muster)' : 'container-query (all pairs)'}
          quickPanelMode={isTouchPrimary ? 'stacked full-width, collapsed by default' : 'side-by-side column'}
        />
      )}

      {isTouchPrimary && (
        <StickyActionBar
          idx={idx}
          steps={STEPS}
          prev={prev}
          next={next}
          exportPdf={exportPdf}
          pdfExportState={pdfExportState}
          isPdfStale={isPdfStale}
          downloadGeneratedPdfClick={downloadGeneratedPdfClick}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          saveStatus={saveStatus}
        />
      )}
    </>
  );
}

/* ── Step: Job Info ── */
function StepJob({ jsa, upd, prev, next }) {
  const isTouchPrimary = useIsTouchPrimary();
  // Date/Job # and Time Issued/Time Expired pair native date/time controls, whose
  // real intrinsic width in WebKit cannot be reliably measured from this codebase
  // (see reports/audits — Chromium-based testing cannot reproduce Safari's native
  // control rendering). On touch devices these always stack as independent
  // full-width fields rather than risk it. Client/Muster Point are plain text
  // inputs with predictable sizing, so they keep the container-query pairing.
  const datePairClass = `formPairRow${isTouchPrimary ? ' forcedStack' : ''}`;
  return (
    <div className="stepStack">
      <div className="stepPanel">
        <div className="stepPanelHeader"><h3>Job Information</h3></div>
        {/* Visual grouping only — same fields, same order, same bindings,
            just presented as related clusters instead of one continuous
            list of ten fields. */}
        <div className="formSectionGroup">
          <div className="formSection">
            <span className="formSectionHeading">Site Details</span>
            <div className="formGrid">
              <div className="formPairRow">
                <F label="Location / City" value={jsa.location} onChange={v => upd({ location: v })} />
                <F label="Job Site" value={jsa.jobSite} onChange={v => upd({ jobSite: v })} />
              </div>
              <div className={datePairClass}>
                <F label="Date" type="date" value={jsa.date} onChange={v => upd({ date: v })} />
                <F label="Job #" value={jsa.jobNumber} onChange={v => upd({ jobNumber: v })} />
              </div>
            </div>
          </div>
          <div className="formSection">
            <span className="formSectionHeading">Client and Schedule</span>
            <div className="formGrid">
              <div className="formPairRow">
                <F label="Client" value={jsa.client} onChange={v => upd({ client: v })} />
                <F label="Muster Point" value={jsa.musterPoint} onChange={v => upd({ musterPoint: v })} />
              </div>
              <div className={datePairClass}>
                <F label="Time Issued" type="time" value={jsa.timeIssued} onChange={v => upd({ timeIssued: v })} />
                <F label="Time Expired" type="time" value={jsa.timeExpired} onChange={v => upd({ timeExpired: v })} />
              </div>
            </div>
          </div>
          <div className="formSection">
            <span className="formSectionHeading">Supervision and Emergency</span>
            <div className="formGrid">
              <div className="formPairRow">
                <F label="Superintendent / Foreman" value={jsa.superintendentForeman} onChange={v => upd({ superintendentForeman: v })} />
                <F label="Emergency / Rescue Phone #" value={jsa.emergencyPhone} onChange={v => upd({ emergencyPhone: v })} />
              </div>
              <div className="formPairRow">
                <F label="Site Contact Phone #" value={jsa.siteContactPhone} onChange={v => upd({ siteContactPhone: v })} />
                <F label="Nearest Medical Facility" value={jsa.nearestMedicalFacility} onChange={v => upd({ nearestMedicalFacility: v })} />
              </div>
              <F label="Assigned Mentor / SSE Number" value={jsa.assignedMentorSse} onChange={v => upd({ assignedMentorSse: v })} />
            </div>
          </div>
        </div>
      </div>
      <StepFooter prev={prev} next={next} hasPrev={false} hasNext />
    </div>
  );
}

/* ── Shared contextual Suggestions system (touch devices) ──
   Reuses QuickPanel exactly as-is (same component, same recent/favorites/
   search/localStorage logic) — only changes where it renders. Desktop keeps
   the existing always-visible side-by-side QuickPanel unchanged. `quickPanelTitle`
   is passed straight through to QuickPanel unchanged so its derived localStorage
   keys never change; `sheetTitle` is only the overlay's own visible heading. */
function SuggestionsSheet({ title, onClose, children }) {
  const dialogRef = useFocusTrapDialog(onClose);
  return (
    <div className="suggestionsOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="suggestionsSheet" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <div className="suggestionsSheetHead">
          <strong>{title}</strong>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close suggestions">Close</button>
        </div>
        <div className="suggestionsSheetBody">{children}</div>
      </div>
    </div>
  );
}
function FieldWithSuggestions({ label, value, onChange, onBlur, rows, placeholder, quickPanelTitle, sheetTitle, groups, onPick, onRemove, itemType, mode, fieldKey, activeSuggestion, setActiveSuggestion, voice = false, voiceMode = 'narrative', chips = false }) {
  const isTouchPrimary = useIsTouchPrimary();
  const field = chips
    ? <ChipEntryTA label={label} value={value} onChange={onChange} placeholder={placeholder} voice={voice} voiceMode={voiceMode} />
    : <TA label={label} value={value} onChange={onChange} onBlur={onBlur} rows={rows} placeholder={placeholder} voice={voice} voiceMode={voiceMode} />;
  if (!isTouchPrimary) {
    return (
      <div className="fieldWithQuick">
        {field}
        <QuickPanel title={quickPanelTitle} groups={groups} onPick={onPick} onRemove={onRemove} existingValue={value} itemType={itemType} mode={mode} />
      </div>
    );
  }
  const isOpen = activeSuggestion === fieldKey;
  return (
    <div className="fieldStack">
      {field}
      <button type="button" className="suggestionsTrigger" onClick={() => setActiveSuggestion(fieldKey)}>
        Suggestions
      </button>
      {isOpen && (
        <SuggestionsSheet title={sheetTitle} onClose={() => setActiveSuggestion(null)}>
          <QuickPanel forceOpen title={quickPanelTitle} groups={groups} onPick={onPick} onRemove={onRemove} existingValue={value} itemType={itemType} mode={mode} />
        </SuggestionsSheet>
      )}
    </div>
  );
}

/* ── Step: Meeting Info ── */
function StepMeeting({ jsa, upd, prev, next }) {
  const [activeSuggestion, setActiveSuggestion] = useState(null);
  return (
    <div className="stepStack">
      <div className="stepPanel">
        <div className="stepPanelHeader">
          <h3>Daily Safety Meeting</h3>
          <p>Use quick inserts as shortcuts, then adjust wording as needed.</p>
        </div>
        <div className="formGrid">
          <FieldWithSuggestions
            label="Tailgate Safety Topic" value={jsa.tailgateTopic} onChange={v => upd({ tailgateTopic: v })} rows={4}
            placeholder="Topic discussed at today's tailgate meeting."
            quickPanelTitle="Quick Topics" sheetTitle="Topic Suggestions" groups={TAILGATE_GROUPS} mode="single"
            onPick={item => upd({ tailgateTopic: item })} onRemove={() => upd({ tailgateTopic: '' })}
            fieldKey="topic" activeSuggestion={activeSuggestion} setActiveSuggestion={setActiveSuggestion}
            voice
          />
          <FieldWithSuggestions
            label="Previous Day Injury / Near Miss" value={jsa.previousDaySafety} onChange={v => upd({ previousDaySafety: v })} rows={4}
            placeholder="Enter previous day safety status."
            quickPanelTitle="Quick Previous Day" sheetTitle="Previous Day Suggestions" groups={PREV_DAY_GROUPS} mode="single"
            onPick={item => upd({ previousDaySafety: item })} onRemove={() => upd({ previousDaySafety: '' })}
            fieldKey="previousDay" activeSuggestion={activeSuggestion} setActiveSuggestion={setActiveSuggestion}
            voice
          />
          <FieldWithSuggestions
            label="Overall Work Task or Activity" value={jsa.overallWorkTask} onChange={v => upd({ overallWorkTask: v })} rows={4}
            placeholder="Describe the overall scope of work today."
            quickPanelTitle="Quick Overall Tasks" sheetTitle="Overall Task Suggestions" groups={OVERALL_TASK_GROUPS} mode="single"
            onPick={item => upd({ overallWorkTask: item })} onRemove={() => upd({ overallWorkTask: '' })}
            fieldKey="overallTask" activeSuggestion={activeSuggestion} setActiveSuggestion={setActiveSuggestion}
            voice
          />
        </div>
      </div>
      <StepFooter prev={prev} next={next} hasPrev hasNext />
    </div>
  );
}

/* ── Step: Tasks / Hazards ── */
function StepWork({ jsa, upd, updRow, removeRow, customQuick, prev, next }) {
  const [activeSuggestion, setActiveSuggestion] = useState(null);
  const [taskSuggestionModal, setTaskSuggestionModal] = useState(null); // { task, hazards, controls }
  const [removeBundleModal, setRemoveBundleModal] = useState(null); // { task, hazards, controls }

  const taskGroups = useMemo(() => customQuick?.task?.length
    ? [{ title: 'My Custom Tasks', items: customQuick.task }, ...DAILY_TASK_GROUPS]
    : DAILY_TASK_GROUPS, [customQuick]);
  const hazardGroups = useMemo(() => customQuick?.hazard?.length
    ? [{ title: 'My Custom Hazards', items: customQuick.hazard }, ...HAZARD_GROUPS]
    : HAZARD_GROUPS, [customQuick]);
  const controlGroups = useMemo(() => customQuick?.control?.length
    ? [{ title: 'My Custom Controls', items: customQuick.control }, ...CONTROL_GROUPS]
    : CONTROL_GROUPS, [customQuick]);

  // Suggestion bundles: lightweight interaction metadata recording which task
  // introduced which hazard/control entries, so a bundle can be reversed later
  // without guessing. The visible fields stay the sole source of truth — see
  // removeTaskAndBundle for how pre-existing/shared/edited entries are protected.
  const bundles = jsa.suggestionBundles || [];
  function findBundleForTask(taskText) {
    return bundles.find(b => normalizeEntry(b.taskText) === normalizeEntry(taskText));
  }

  function addTaskOnly(taskText) {
    upd({ dailyTasks: addExactEntry(jsa.dailyTasks, taskText).value });
  }

  function addTaskWithSuggestions(taskText, hazardsSelected, controlsSelected) {
    const taskResult = addExactEntry(jsa.dailyTasks, taskText);
    let hazardsValue = jsa.hazardsSummary;
    const introducedHazards = [];
    hazardsSelected.forEach(h => {
      const res = addExactEntry(hazardsValue, h);
      hazardsValue = res.value;
      if (res.added) introducedHazards.push(h); // not added => was pre-existing (or shared with another bundle) at add time
    });
    let controlsValue = jsa.controlsSummary;
    const introducedControls = [];
    controlsSelected.forEach(c => {
      const res = addExactEntry(controlsValue, c);
      controlsValue = res.value;
      if (res.added) introducedControls.push(c);
    });
    const bundle = {
      id: crypto.randomUUID?.() || String(Date.now()),
      taskText,
      // Full set this bundle currently wants present — lets a DIFFERENT bundle's
      // later removal check "does this other bundle still want it" regardless of
      // which bundle happened to insert it first (see removeTaskAndBundle).
      selectedHazards: hazardsSelected.slice(),
      selectedControls: controlsSelected.slice(),
      // Only the subset THIS bundle actually introduced — the only items this
      // bundle is ever allowed to consider removing (rule: never touch anything
      // that pre-existed before this bundle touched it).
      hazards: introducedHazards,
      controls: introducedControls,
    };
    upd({
      dailyTasks: taskResult.value,
      hazardsSummary: hazardsValue,
      controlsSummary: controlsValue,
      suggestionBundles: [...bundles, bundle],
    });
  }

  function removeTaskOnly(taskText) {
    upd({
      dailyTasks: removeExactEntry(jsa.dailyTasks, taskText),
      suggestionBundles: bundles.filter(b => normalizeEntry(b.taskText) !== normalizeEntry(taskText)),
    });
  }

  function removeTaskAndBundle(taskText) {
    const bundle = findBundleForTask(taskText);
    let hazardsValue = jsa.hazardsSummary;
    let controlsValue = jsa.controlsSummary;
    let otherBundles = bundles.filter(b => b.id !== bundle?.id);
    if (bundle) {
      // Only ever consider items THIS bundle actually introduced (bundle.hazards/
      // controls) — never something that pre-existed before it. If another active
      // bundle still wants the item present, don't delete the text — instead
      // transfer introduced-ownership to that bundle, so if IT is later removed
      // (and nothing else wants the item by then), cleanup can still finish
      // correctly instead of leaving the item permanently un-owned.
      bundle.hazards.forEach(h => {
        const owner = otherBundles.find(b => (b.selectedHazards || []).some(x => normalizeEntry(x) === normalizeEntry(h)));
        if (owner) {
          otherBundles = otherBundles.map(b => (b.id === owner.id && !b.hazards.some(x => normalizeEntry(x) === normalizeEntry(h)))
            ? { ...b, hazards: [...b.hazards, h] }
            : b);
        } else {
          hazardsValue = removeExactEntry(hazardsValue, h);
        }
      });
      bundle.controls.forEach(c => {
        const owner = otherBundles.find(b => (b.selectedControls || []).some(x => normalizeEntry(x) === normalizeEntry(c)));
        if (owner) {
          otherBundles = otherBundles.map(b => (b.id === owner.id && !b.controls.some(x => normalizeEntry(x) === normalizeEntry(c)))
            ? { ...b, controls: [...b.controls, c] }
            : b);
        } else {
          controlsValue = removeExactEntry(controlsValue, c);
        }
      });
    }
    upd({
      dailyTasks: removeExactEntry(jsa.dailyTasks, taskText),
      hazardsSummary: hazardsValue,
      controlsSummary: controlsValue,
      suggestionBundles: otherBundles,
    });
  }

  function handleTaskPick(item) {
    const task = typeof item === 'string' ? item : item.label;
    const suggestion = findTaskSuggestion(task);
    if (!suggestion || (!suggestion.hazards.length && !suggestion.controls.length)) {
      addTaskOnly(task);
      return;
    }
    setTaskSuggestionModal({ task, hazards: suggestion.hazards, controls: suggestion.controls });
  }
  function handleTaskRemove(item) {
    const task = typeof item === 'string' ? item : item.label;
    const bundle = findBundleForTask(task);
    if (!bundle || (bundle.hazards.length === 0 && bundle.controls.length === 0)) {
      removeTaskOnly(task);
      return;
    }
    setRemoveBundleModal({ task, hazards: bundle.hazards, controls: bundle.controls });
  }
  function handleHazardPick(item) {
    const label = typeof item === 'string' ? item : item.label;
    upd({ hazardsSummary: addExactEntry(jsa.hazardsSummary, label).value });
  }
  function handleHazardRemove(item) {
    const label = typeof item === 'string' ? item : item.label;
    upd({ hazardsSummary: removeExactEntry(jsa.hazardsSummary, label) });
  }
  function handleControlPick(item) {
    const label = typeof item === 'string' ? item : item.label;
    upd({ controlsSummary: addExactEntry(jsa.controlsSummary, label).value });
  }
  function handleControlRemove(item) {
    const label = typeof item === 'string' ? item : item.label;
    upd({ controlsSummary: removeExactEntry(jsa.controlsSummary, label) });
  }

  return (
    <div className="stepStack">
      <div className="stepPanel">
        <div className="stepPanelHeader">
          <h3>Tasks, Hazards, and Controls</h3>
          <p>Tasks describe the work. Hazards describe what could cause harm. Controls describe how the risk will be reduced.</p>
        </div>
        <div className="formSectionGroup">
          <div className="formSection">
            <div className="formGrid">
              <FieldWithSuggestions
                label="Tasks for Today" value={jsa.dailyTasks} onChange={v => upd({ dailyTasks: v })}
                placeholder="Type a task, then press Enter to add it."
                quickPanelTitle="Quick Daily Tasks" sheetTitle="Daily Task Suggestions" groups={taskGroups}
                onPick={handleTaskPick} onRemove={handleTaskRemove}
                fieldKey="dailyTasks" activeSuggestion={activeSuggestion} setActiveSuggestion={setActiveSuggestion}
                voice voiceMode="list" chips
              />
            </div>
          </div>
          <div className="formSection">
            <div className="formGrid">
              <FieldWithSuggestions
                label="Hazards in Work Area" value={jsa.hazardsSummary} onChange={v => upd({ hazardsSummary: v })}
                placeholder="Type a hazard, then press Enter to add it."
                quickPanelTitle="Quick Hazards" sheetTitle="Hazard Suggestions" groups={hazardGroups}
                onPick={handleHazardPick} onRemove={handleHazardRemove}
                fieldKey="hazards" activeSuggestion={activeSuggestion} setActiveSuggestion={setActiveSuggestion}
                voice voiceMode="list" chips
              />
            </div>
          </div>
          <div className="formSection">
            <div className="formGrid">
              <FieldWithSuggestions
                label="Controls and Mitigations" value={jsa.controlsSummary} onChange={v => upd({ controlsSummary: v })}
                placeholder="Type a control, then press Enter to add it."
                quickPanelTitle="Quick Controls" sheetTitle="Control Suggestions" groups={controlGroups}
                onPick={handleControlPick} onRemove={handleControlRemove}
                fieldKey="controls" activeSuggestion={activeSuggestion} setActiveSuggestion={setActiveSuggestion}
                voice voiceMode="list" chips
              />
            </div>
          </div>
        </div>
      </div>

      {taskSuggestionModal && (
        <TaskSuggestionModal
          task={taskSuggestionModal.task}
          hazards={taskSuggestionModal.hazards}
          controls={taskSuggestionModal.controls}
          onCancel={() => setTaskSuggestionModal(null)}
          onTaskOnly={() => { addTaskOnly(taskSuggestionModal.task); setTaskSuggestionModal(null); }}
          onAddSelected={(hazards, controls) => { addTaskWithSuggestions(taskSuggestionModal.task, hazards, controls); setTaskSuggestionModal(null); }}
        />
      )}
      {removeBundleModal && (
        <RemoveBundleModal
          task={removeBundleModal.task}
          hazards={removeBundleModal.hazards}
          controls={removeBundleModal.controls}
          onCancel={() => setRemoveBundleModal(null)}
          onRemoveTaskOnly={() => { removeTaskOnly(removeBundleModal.task); setRemoveBundleModal(null); }}
          onRemoveBundle={() => { removeTaskAndBundle(removeBundleModal.task); setRemoveBundleModal(null); }}
        />
      )}

      {(jsa.taskRows || []).length > 0 && (
        <div className="detailedRowsBody">
          <div className="standardBehaviorBox">
            <div>
              <strong>Older Detailed Task Rows</strong>
              <p>Carried over from before this JSA used the single Tasks / Hazards / Controls list above. Edit or remove them below — new entries only go in the fields above now.</p>
            </div>
          </div>
          <div className="taskRowList">
            {(jsa.taskRows || []).map((row, i) => (
              <div className="taskRow" key={row.id ?? i}>
                <div className="taskRowHead">
                  <strong>Task Row #{i + 1}</strong>
                  <button className="miniDanger" onClick={() => removeRow(i)}>Remove</button>
                </div>
                <div className="taskRowBody">
                  <TA label="Task / Activity" value={row.step} onChange={v => updRow(i, { step: v })} rows={3} voice />
                  <TA label="Task-Specific Hazards" value={row.hazards} onChange={v => updRow(i, { hazards: v })} onBlur={() => updRow(i, { hazards: dedupeList(splitLines(row.hazards)).join('\n') })} rows={3} voice />
                  <TA label="Task-Specific Controls" value={row.controls} onChange={v => updRow(i, { controls: v })} onBlur={() => updRow(i, { controls: dedupeList(splitLines(row.controls)).join('\n') })} rows={3} voice />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <StepFooter prev={prev} next={next} hasPrev hasNext />
    </div>
  );
}

/* ── Step: Signatures ──
   An explicit choice (Fonzo, 2026-08-31), not inferred from whether the
   kiosk happens to have been touched -- an earlier same-day pass tried
   that (line-count field only shown before the first kiosk signature)
   and it read as the feature just vanishing once the crew started
   signing, with nothing on screen explaining why. Two real modes:
   'kiosk' -- crew signs on this device, CrewSignInKiosk's own "Done
   Signing" auto-sets 20 blank lines after the digital ones for late
   arrivals/visitors, same as the 2026-08-19 "no more choosing" decision.
   'printout' -- nobody signs digitally; signatureLineCount (1-100,
   user-set) is the sheet's ENTIRE blank-line count (see
   signInLineTotal's comment above), for printing and signing in pen. */
function StepSignatures({ jsa, upd, prev, next, onOpenKiosk }) {
  const crewSignedCount = jsa.crewSignatures?.length || 0;
  const mode = jsa.signInMode === 'printout' ? 'printout' : 'kiosk';
  const [lineCountInput, setLineCountInput] = useState(String(jsa.signatureLineCount ?? 30));
  useEffect(() => { setLineCountInput(String(jsa.signatureLineCount ?? 30)); }, [jsa.signatureLineCount]);
  function commitLineCount() {
    const n = Math.max(1, Math.min(100, parseInt(lineCountInput, 10) || 30));
    setLineCountInput(String(n));
    if (n !== Number(jsa.signatureLineCount)) upd({ signatureLineCount: n });
  }
  return (
    <div className="stepStack">
      <div className="stepPanel">
        <div className="stepPanelHeader"><h3>Signatures and Acknowledgement</h3></div>
        <div className="formGrid">
          <TA label="Acknowledgement Text" value={jsa.acknowledgement} onChange={v => upd({ acknowledgement: v })} rows={6} />
          <div className="field">
            <span>How will this JSA be signed?</span>
            <div className="yesNoToggle">
              <button type="button" className={`btn${mode === 'kiosk' ? ' active' : ''}`} onClick={() => upd({ signInMode: 'kiosk' })}>Kiosk — Sign on This Device</button>
              <button type="button" className={`btn${mode === 'printout' ? ' active' : ''}`} onClick={() => upd({ signInMode: 'printout' })}>Print &amp; Sign in Pen</button>
            </div>
          </div>
          {mode === 'kiosk' ? (
            <div className="sigRuleBox">
              <strong>Crew Sign-In (kiosk mode)</strong>
              <p>{crewSignedCount === 0 ? 'No one has signed yet.' : `${crewSignedCount} crew member${crewSignedCount === 1 ? '' : 's'} signed so far — their signatures will print on the attached sign-in sheet.`}</p>
              <p className="helperText">20 extra blank lines print after them automatically, for anyone who signs in ink later.</p>
              <button type="button" className="btn secondary sm" onClick={onOpenKiosk}>{crewSignedCount > 0 ? 'Continue Signing' : 'Start Crew Sign-In'}</button>
            </div>
          ) : (
            <div className="sigRuleBox">
              <strong>Print &amp; Sign in Pen</strong>
              <p>Nobody signs on this device. The printed sheet gets exactly the number of blank lines below for the crew to sign by hand.</p>
              <label className="field">
                <span>Signature boxes to print</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={lineCountInput}
                  onChange={e => setLineCountInput(e.target.value)}
                  onBlur={commitLineCount}
                />
              </label>
            </div>
          )}
        </div>
      </div>
      <StepFooter prev={prev} next={next} hasPrev hasNext />
    </div>
  );
}

/* ── Step: Review (content checkpoint before the crew signs) ──
   Split off Finish & Export (2026-08-19, Fonzo) so the crew's actual
   content review happens BEFORE signatures instead of after -- signing used
   to come first (Signatures step), then a step literally called "Review"
   followed it, which read backwards once you noticed the crew had already
   reviewed the JSA out loud at the tailgate meeting before signing. Now the
   checklist/preview/notes moment lives here, ahead of Signatures, and the
   old export mechanics (Create Document, Save as Template, Document
   Options) live in StepExport below, after Signatures, where nothing left
   to review, only paperwork to wrap up. */
function StepContentReview({ jsa, upd, checks, plan, fit, prev, next, setJsaStep }) {
  const completeCount = checks.filter(check => check.ok).length;
  const allGood = completeCount === checks.length;
  return (
    <div className="stepStack">
      <div className="stepPanel">
        <div className="stepPanelHeader">
          <h3>Review</h3>
          <p>Make sure everything's right before the crew signs.</p>
        </div>
        <div className="formGrid">
          <TA label="Internal Notes / Special Instructions" value={jsa.notes} onChange={v => upd({ notes: v })} rows={4} placeholder="Optional notes visible in the draft only, not on the printed JSA." />

          {/* One calm line when everything's actually fine -- the full
              checklist grid (percentage ring, 8 boxes, page-plan grid) only
              earns its space when there's something to fix (Fonzo,
              2026-08-19: "the review readiness ... might look good to you
              but to a human it's annoying"). */}
          {allGood ? (
            <div className="reviewAllGoodBanner">
              <span className="reviewAllGoodCheck" aria-hidden="true">✓</span>
              <div>
                <strong>Looks good — ready for the crew to sign.</strong>
                <p>{plan.totalPages} page{plan.totalPages === 1 ? '' : 's'} total ({plan.continuationPages.length} continuation, {plan.signInPages.length} sign-in). {fit.message}</p>
              </div>
            </div>
          ) : (
            <div className={`reviewSummaryCard ${fit.status}`}>
              <div className="reviewSummaryHead">
                <div>
                  <span className="suggestionEyebrow">Review readiness</span>
                  <h4>{completeCount} of {checks.length} checks complete</h4>
                </div>
                <span className="reviewScore">{Math.round((completeCount / checks.length) * 100)}%</span>
              </div>
              <p className="reviewFitMessage">{fit.message}</p>
              <div className="reviewChecklist">
                {checks.map(check => (
                  <button
                    type="button"
                    className={`reviewCheck${check.ok ? ' ok' : ' missing'}`}
                    key={check.label}
                    onClick={() => setJsaStep(check.step)}
                    disabled={check.ok || !check.step}
                  >
                    <span>{check.ok ? '✓' : '!'}</span>
                    <p>{check.label}</p>
                  </button>
                ))}
              </div>
              <div className="exportPlanGrid">
                <div><strong>Main JSA</strong><span>1 page</span></div>
                <div><strong>Continuation</strong><span>{plan.continuationPages.length}</span></div>
                <div><strong>Sign-In</strong><span>{plan.signInPages.length}</span></div>
                <div><strong>Total</strong><span>{plan.totalPages}</span></div>
              </div>
            </div>
          )}

          <div className="reviewPrimaryAction">
            <button className="btn primary lg" onClick={next}>Ready for Crew to Sign</button>
          </div>
          <p className="helperText">Moves on to Signatures. If anything above still needs fixing, you'll get a chance to go back first.</p>
        </div>
      </div>
      <StepFooter prev={prev} next={next} hasPrev hasNext={false} />
    </div>
  );
}

/* ── Step: Finish & Export ── */
function StepExport({ jsa, saveName, setSaveName, saveTemplate, updateTemplate, saveDraft, markReady, exportPdf, legacyBrowserPrint, pdfExportState, isPdfStale, downloadGeneratedPdfClick, clearDraft, prev, next }) {
  const [showDocOptions, setShowDocOptions] = useState(false);
  const isGenerating = pdfExportState?.phase === 'generating';
  const isReady = pdfExportState?.phase === 'ready';
  const exportLabel = pdfExportStatusLabel(pdfExportState);
  return (
    <div className="stepStack">
      <div className="stepPanel">
        <div className="stepPanelHeader">
          <h3>Finish & Export</h3>
          <p>Generate the PDF, save a template, or wrap up the draft.</p>
        </div>
        <div className="formGrid">
          <div className="exportNamePreview">
            <strong>Suggested PDF filename</strong>
            <code>{buildExportName(jsa)}.pdf</code>
          </div>

          {!isReady && (
            <div className="reviewPrimaryAction">
              <button className="btn primary lg" onClick={exportPdf} disabled={isGenerating} aria-busy={isGenerating}>{exportLabel || 'Create Document'}</button>
            </div>
          )}

          {!isReady && <p className="helperText">Creates the document, ready to download. The app does not store final documents.</p>}

          {isReady && isPdfStale && (
            <div className="pdfStaleWarning">
              <strong>Document changed — update it before downloading.</strong>
              <p>The draft was edited after this document was created, so it no longer reflects the current content.</p>
              <button className="btn primary sm" onClick={exportPdf} disabled={isGenerating} aria-busy={isGenerating}>{exportLabel || 'Update Document'}</button>
            </div>
          )}

          {isReady && !isPdfStale && (
            <div className="pdfReadyPanel">
              <span className="pdfReadyEyebrow">Document Ready</span>
              <strong className="pdfReadyHeadline">{pdfExportState.pageCount} page{pdfExportState.pageCount === 1 ? '' : 's'}</strong>
              <p className="pdfReadyFilename">{pdfExportState.filename}</p>
              <div className="pdfReadyActions">
                <button className="btn primary lg" onClick={downloadGeneratedPdfClick}>Download Document</button>
              </div>
              <p className="helperText pdfReadyHelper">Download the document, then open it to print. The app does not store final documents.</p>
            </div>
          )}

          <div className="reviewSecondaryActions">
            <button type="button" className="btn ghost sm" onClick={() => setShowDocOptions(true)} disabled={isGenerating}>Document Options</button>
            <span className="reviewAutosaveNote">Drafts autosave automatically.</span>
          </div>

          <div className="card">
            <div className="cardHeader"><strong>Save as Template</strong></div>
            <label className="field">
              <span>Template name</span>
              <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Example: Entergy JSA" />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary sm" onClick={saveTemplate}>Save Template</button>
              <button type="button" className="btn ghost sm" onClick={updateTemplate}>Update Loaded</button>
            </div>
            <p className="helperText">Loading a template starts a fresh JSA for today and never carries over signatures or daily work details. Want to share a saved template with someone else? Do that from the Templates tab.</p>
          </div>
        </div>
      </div>
      {showDocOptions && (
        <DocumentOptionsSheet
          onClose={() => setShowDocOptions(false)}
          saveDraft={saveDraft}
          markReady={markReady}
          clearDraft={clearDraft}
          legacyBrowserPrint={legacyBrowserPrint}
          isGenerating={isGenerating}
        />
      )}
      <StepFooter prev={prev} next={next} hasPrev hasNext={false} />
    </div>
  );
}

/* ── Step footer ── */
function StepFooter({ prev, next, hasPrev, hasNext }) {
  // Touch devices get the sticky workflow action bar (JsaWorkflow) instead —
  // this avoids duplicate Back/Next controls on the same screen.
  const isTouchPrimary = useIsTouchPrimary();
  if (isTouchPrimary) return null;
  return (
    <div className="stepFooter">
      <div className="leftBtns">
        {hasPrev && <button className="btn ghost" onClick={prev}>Back</button>}
      </div>
      <div className="rightBtns">
        {hasNext && <button className="btn primary" onClick={next}>Next</button>}
      </div>
    </div>
  );
}

/* ── Drafts view ── */
/* ── Drafts view ──
   `entries` is one row descriptor per document type that supportsDrafts in
   DOCUMENT_REGISTRY (see App()'s draftEntries) — a new document only needs
   to add its own entry object to that array to show up here, instead of
   this component growing a hardcoded block per document type. Only
   documents with an actual saved draft render a row; if none exist, one
   shared empty state points at Documents. */
function DraftsView({ entries, goDocs }) {
  const withDrafts = entries.filter(e => e.savedDraft);
  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">Drafts</div>
        <h2>Saved Drafts</h2>
        <p>Drafts are editable documents saved on this device. Export final PDFs outside the app.</p>
      </div>
      {withDrafts.length ? (
        <div className="listStack">
          {withDrafts.map(e => (
            <div className="listItem" key={e.id}>
              <div className="itemInfo">
                <div className="itemInfoTitleRow">
                  <strong>{e.draftTitle}</strong>
                  <span className={`badge ${e.savedDraft.status === 'ready' || e.savedDraft.status === 'completed' ? 'ready' : 'draft'}`}>
                    {e.savedDraft.status === 'completed' ? 'Completed' : e.savedDraft.status === 'ready' ? 'Ready to Export' : 'Draft'}
                  </span>
                </div>
                <p>{e.metaLine}</p>
              </div>
              <div className="itemActions">
                <button className="btn secondary sm" onClick={e.onOpen}>Open Draft</button>
                <button className="btn ghost sm" onClick={e.onDelete}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <p>No saved drafts on this device.</p>
          <button className="btn primary sm" onClick={goDocs}>Browse Documents</button>
        </div>
      )}
    </div>
  );
}

/* ── Templates view ── */
function TemplatesView({ allTemplates, customTemplates, loadTemplate, deleteTemplate, startBlank, shareTemplate, importTemplateFile }) {
  const importInputRef = useRef(null);
  function onImportInputChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importTemplateFile(file);
  }
  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">Templates</div>
        <h2>Reusable Templates</h2>
        <p>Templates save recurring job information, hazards, controls, and setup language. They are not final documents. Save a custom template from the JSA builder.</p>
      </div>
      <div className="listStack">
        <div className="listItem">
          <div className="itemInfo">
            <strong>Blank JSA</strong>
            <p>Start from a clean form and build a new template if needed.</p>
          </div>
          <div className="itemActions">
            <button className="btn secondary sm" onClick={startBlank}>Use Blank</button>
          </div>
        </div>
        <div className="listItem">
          <div className="itemInfo">
            <strong>Import a Template</strong>
            <p>Received a template file someone shared with you? Import it here to add it to your own list.</p>
          </div>
          <div className="itemActions">
            <input ref={importInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportInputChange} />
            <button className="btn secondary sm" onClick={() => importInputRef.current?.click()}>Import Template</button>
          </div>
        </div>
        {customTemplates.length ? customTemplates.map(t => (
          <div className="listItem" key={t.id}>
            <div className="itemInfo">
              <strong>{t.name}</strong>
              <p>Updated {t.updatedAt ? nowNice(new Date(t.updatedAt)) : 'on this device'}</p>
            </div>
            <div className="itemActions">
              <button className="btn secondary sm" onClick={() => loadTemplate(t.id)}>Load</button>
              <button className="btn ghost sm" onClick={() => shareTemplate(t)}>Share</button>
              <button className="btn ghost sm" onClick={() => deleteTemplate(t.id)}>Delete</button>
            </div>
          </div>
        )) : (
          <div className="emptyState">
            <p>No custom templates yet. Save one from the Finish & Export step after filling in recurring job information.</p>
            <button className="btn primary sm" onClick={startBlank}>Start a JSA</button>
          </div>
        )}
      </div>
      <div className="card">
        <div className="cardHeader"><h3>How Templates Work</h3></div>
        <div className="cardBody">
          <p>A template captures job info, hazards, and controls so you don't retype them every day. Day-specific details — the date, times, tailgate topic, and signatures — reset automatically so each new JSA starts fresh. Save a template anytime from the Finish & Export step of a JSA you've filled in.</p>
        </div>
      </div>
    </div>
  );
}

/* ── Settings view ── */
function SettingsView({ settings, setSettings }) {
  const [quickType, setQuickType] = useState('task');
  const [quickLabel, setQuickLabel] = useState('');
  const customQuick = settings.customQuick || { task: [], hazard: [], control: [] };

  function addCustomQuick() {
    const label = quickLabel.trim();
    if (!label) return;
    const existing = customQuick[quickType] || [];
    if (existing.some(item => isNearDuplicate(item, label))) {
      alert(`A similar ${quickType} already exists in your custom list.`);
      return;
    }
    setSettings(prev => ({
      ...prev,
      customQuick: {
        ...(prev.customQuick || { task: [], hazard: [], control: [] }),
        [quickType]: [...existing, label],
      },
    }));
    setQuickLabel('');
  }

  function removeCustomQuick(type, label) {
    setSettings(prev => ({
      ...prev,
      customQuick: {
        ...(prev.customQuick || { task: [], hazard: [], control: [] }),
        [type]: (prev.customQuick?.[type] || []).filter(item => normalizeEntry(item) !== normalizeEntry(label)),
      },
    }));
  }

  return (
    <div className="sectionStack">
      <div className="sectionTitle">
        <div className="eyebrow">Settings</div>
        <h2>App Settings</h2>
        <p>This build stores drafts, templates, favorites, recent items, and custom quick adds locally on this device.</p>
      </div>
      <div className="card">
        <div className="cardHeader"><h3>Appearance</h3></div>
        <div className="cardBody">
          <div className="settingsRow">
            <div className="rowInfo">
              <strong>Theme</strong>
              <p>Light mode uses a navy-and-off-white workspace and is the primary experience. Dark mode uses layered navy surfaces with the same red accent.</p>
            </div>
            <button className="btn ghost" onClick={() => setSettings(prev => ({ ...prev, theme: settings.theme === 'dark' ? 'light' : 'dark' }))}>
              Switch to {settings.theme === 'dark' ? 'Light' : 'Dark'} Mode
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">
          <h3>Custom Quick Adds</h3>
          <p>Add company- or site-specific language. You must choose whether it is a task, hazard, or control so it stays in the correct lane.</p>
        </div>
        <div className="cardBody">
          <div className="customQuickBuilder">
            <label className="field">
              <span>Type</span>
              <select value={quickType} onChange={e => setQuickType(e.target.value)}>
                <option value="task">Task — work being performed</option>
                <option value="hazard">Hazard — exposure or harmful condition</option>
                <option value="control">Control — preventive action or requirement</option>
              </select>
            </label>
            <label className="field">
              <span>Custom wording</span>
              <input value={quickLabel} onChange={e => setQuickLabel(e.target.value)} placeholder={`Enter a custom ${quickType}`} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomQuick(); } }} />
            </label>
            <button className="btn primary" onClick={addCustomQuick}>Add Custom Item</button>
          </div>
          <div className="customQuickLists">
            {['task','hazard','control'].map(type => (
              <div className="customQuickList" key={type}>
                <strong>{type === 'task' ? 'Tasks' : type === 'hazard' ? 'Hazards' : 'Controls'}</strong>
                {(customQuick[type] || []).length ? (customQuick[type] || []).map(item => (
                  <div className="customQuickItem" key={item}>
                    <span>{item}</span>
                    <button className="miniDanger" onClick={() => removeCustomQuick(type, item)}>Remove</button>
                  </div>
                )) : <p>No custom {type}s saved.</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader"><h3>Storage Workflow</h3></div>
        <div className="cardBody">
          <div className="workflowNotes">
            <p><strong>Inside the app:</strong> Editable drafts, reusable templates, favorites, recent quick adds, custom quick adds, and settings. One active JSA draft is supported in this pilot build.</p>
            <p><strong>Outside the app:</strong> Final PDFs should be saved to your desktop, iPad Files, OneDrive, iCloud, or project folder after export.</p>
            <p><strong>Important:</strong> All data is stored locally in your browser. Clearing browser data will remove saved drafts, templates, and custom items.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader"><h3>About</h3></div>
        <div className="cardBody">
          <p className="aboutVersionLine">v{APP_VERSION}{BUILD_TIME ? ` · ${buildStamp(BUILD_TIME, BUILD_COMMIT)}` : ''}</p>
        </div>
      </div>
    </div>
  );
}

/* ── JSA Preview ── */
function usePrintDebugFlag() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('debug') === 'print'; }
    catch { return false; }
  }, []);
}
/* Screen-only pagination diagnostics, only mounted behind ?debug=print —
   for verifying the JS page planner's assumptions against what actually
   prints, without needing a real device to inspect internal numbers.
   Two sections: (1) the declared geometry model, always available since
   it's just constants; (2) real captured measurements from the last time
   Print/Print Preview was actually triggered in THIS browser — genuinely
   unavailable until then, since .printOnly only lays out under real print
   media, which this app cannot simulate outside an actual print action. */
function PrintDebugPanel({ jsa, plan }) {
  const diagnostics = usePrintDiagnostics();
  return (
    <div className="printDebugPanel">
      <strong>Print Debug (?debug=print)</strong>
      <dl>
        <div><dt>logical pages</dt><dd>{plan.totalPages} (1 main + {plan.continuationPages.length} continuation + {plan.signInPages.length} sign-in)</dd></div>
        <div><dt>main capacity / used</dt><dd>{plan.mainCapacity} / {plan.mainUsed} {plan.measured ? 'px' : 'units (heuristic)'}</dd></div>
        <div><dt>main populated / filler rows</dt><dd>{plan.mainContentRows.length} populated + {plan.mainRows.length - plan.mainContentRows.length} filler = {plan.mainRows.length} total</dd></div>
        <div><dt>continuation capacity</dt><dd>{plan.measured ? 'see row-height measurement below' : `${continuationRowCapacity()} units/page (heuristic)`}</dd></div>
        <div><dt>continuation pages</dt><dd>{plan.continuationPages.length}</dd></div>
        <div><dt>sign-in pages</dt><dd>{plan.signInPages.length}</dd></div>
        <div><dt>oversized row detected</dt><dd>{String(plan.oversized)}</dd></div>
        <div><dt>upper-section wrapped lines</dt><dd>{estimateUpperSectionLines(jsa)}</dd></div>
      </dl>
      <strong style={{ marginTop: 8 }}>Declared print geometry (single-sheet model)</strong>
      <dl>
        <div><dt>paper / .printPage</dt><dd>{PRINT_PAPER_WIDTH_IN}in x {PRINT_PAPER_HEIGHT_IN}in (Letter — .printPage IS the sheet)</dd></div>
        <div><dt>@page margin</dt><dd>0in (safety margin is internal padding, not @page margin)</dd></div>
        <div><dt>internal padding</dt><dd>{PRINT_PAGE_PADDING_IN}in each side (box-sizing: border-box)</dd></div>
        <div><dt>content box</dt><dd>{PRINT_CONTENT_WIDTH_IN}in x {Math.round(PRINT_CONTENT_HEIGHT_IN * 100) / 100}in</dd></div>
        <div><dt>width / height safety allowance</dt><dd>{Math.round(PRINT_WIDTH_SAFETY_IN * 100) / 100}in / {Math.round(PRINT_HEIGHT_SAFETY_IN * 100) / 100}in</dd></div>
      </dl>
      <strong style={{ marginTop: 8 }}>Row-height measurement (PaginationMeasureRig)</strong>
      <dl>
        <div><dt>plan source</dt><dd>{plan.measured ? 'real measurement' : 'heuristic fallback (not yet measured)'}</dd></div>
        <div><dt>main available height</dt><dd>{plan.measured ? `${plan.mainCapacity}px (${Math.round((plan.mainCapacity / 96) * 100) / 100}in)` : 'n/a — using char-count units'}</dd></div>
        <div><dt>main used height</dt><dd>{plan.measured ? `${plan.mainUsed}px` : 'n/a'}</dd></div>
      </dl>
      <strong style={{ marginTop: 8 }}>
        Physical measurements {diagnostics ? `(captured ${diagnostics.capturedAt})` : '(not yet captured)'}
      </strong>
      {!diagnostics && (
        <p style={{ margin: '2px 0 0', color: '#f5c542' }}>
          Open Print or Print Preview once in this browser to populate real measured
          numbers below — Chromium/desktop figures here are NOT a substitute for
          Safari/AirPrint measurements, which this panel cannot capture until an
          actual print is triggered on the device.
        </p>
      )}
      {diagnostics && diagnostics.pages.map(p => (
        <div key={p.index} style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,.15)', paddingTop: 4 }}>
          <dl>
            <div><dt>page {p.index + 1}</dt><dd>{p.type}</dd></div>
            <div><dt>sheet size</dt><dd>{p.sheetWidthPx}px x {p.sheetHeightPx}px</dd></div>
            <div><dt>break-before / after</dt><dd>{p.breakBefore} / {p.breakAfter} ({p.pageBreakBefore} / {p.pageBreakAfter})</dd></div>
            <div><dt>form outer size</dt><dd>{p.outerWidthIn}in x {p.outerHeightIn}in ({p.outerWidthPx}px x {p.outerHeightPx}px)</dd></div>
            <div><dt>effective margin (t/r/b/l)</dt><dd>{p.effectiveMarginPx.top}/{p.effectiveMarginPx.right}/{p.effectiveMarginPx.bottom}/{p.effectiveMarginPx.left}px</dd></div>
            <div><dt>client / scroll W</dt><dd>{p.clientWidth} / {p.scrollWidth}px</dd></div>
            <div><dt>client / scroll H</dt><dd>{p.clientHeight} / {p.scrollHeight}px</dd></div>
            <div><dt>overflow X / Y</dt><dd>{p.overflowXPx}px / {p.overflowYPx}px</dd></div>
            <div><dt>padding (t/r/b/l)</dt><dd>{p.paddingPx.top}/{p.paddingPx.right}/{p.paddingPx.bottom}/{p.paddingPx.left}px</dd></div>
            <div><dt>border (t/r/b/l)</dt><dd>{p.borderPx.top}/{p.borderPx.right}/{p.borderPx.bottom}/{p.borderPx.left}px</dd></div>
            <div><dt>box-sizing</dt><dd>{p.boxSizing}</dd></div>
            {p.columnWidths.length > 0 && (
              <div><dt>column widths</dt><dd>{p.columnWidths.map(c => `${c.widthPx}px (${c.widthPct}%)`).join(', ')}</dd></div>
            )}
            <div><dt>task rows (populated+filler)</dt><dd>{p.rowCount}</dd></div>
            <div><dt>last 5 row heights</dt><dd>{p.lastRows.map(r => `${r.heightPx}px`).join(', ') || 'n/a'}</dd></div>
            <div><dt>min row height (last 5)</dt><dd>{p.minRowHeightPx == null ? 'n/a' : `${p.minRowHeightPx}px`} {p.anyRowBelowMinimum ? `(BELOW ${PRINT_TASK_ROW_MIN_PX}px minimum)` : ''}</dd></div>
            <div><dt>footer top / bottom</dt><dd>{p.footerTopPx == null ? 'n/a' : `${p.footerTopPx}px / ${p.footerBottomPx}px`} (page height {p.outerHeightPx}px)</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function JsaPreview({ jsa }) {
  const plan = useJsaPagePlan(jsa);
  const fit = calcFitFromPlan(plan);
  const printDebug = usePrintDebugFlag();
  const viewportRef = useRef(null);
  const [scale, setScale] = useState(0.55);
  const [pagerOpen, setPagerOpen] = useState(false);
  const [pagerStart, setPagerStart] = useState(0);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => {
      const width = Math.max(280, node.clientWidth - 28);
      setScale(Math.min(1, width / 816));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function openPager(startIndex) {
    setPagerStart(startIndex);
    setPagerOpen(true);
  }

  return (
    <>
      {printDebug && <PrintDebugPanel jsa={jsa} plan={plan} />}
      <div className="previewPageManager">
        <span><strong>Main JSA</strong> 1</span>
        <span><strong>Continuation</strong> {plan.continuationPages.length}</span>
        <span><strong>Sign-In</strong> {plan.signInPages.length}</span>
        <span className="previewTotal"><strong>Total</strong> {plan.totalPages}</span>
      </div>
      <div className="previewTruthBar">
        <span className={`previewFit ${fit.status}`}>{fit.label}</span>
        <p>Exact Letter-page preview with standard default-margin space.</p>
        {plan.totalPages > 1 && (
          <button type="button" className="btn ghost sm previewViewAllBtn" onClick={() => openPager(0)}>View All {plan.totalPages} Pages</button>
        )}
      </div>
      <div
        className="previewSheetViewport previewSheetViewportClickable"
        ref={viewportRef}
        style={{ height: `${1056 * scale + 28}px` }}
        onClick={() => openPager(0)}
        role="button"
        tabIndex={0}
        aria-label="Open full print preview"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPager(0); } }}
      >
        <div className="previewSheetCanvas" style={{ transform: `scale(${scale})` }}>
          <div className="previewDefaultMargin">
            <MainJsaDocumentPage jsa={jsa} plan={plan} className="previewDocumentPage" />
          </div>
        </div>
      </div>
      {pagerOpen && <JsaPreviewPagerModal jsa={jsa} plan={plan} initialIndex={pagerStart} onClose={() => setPagerOpen(false)} />}
    </>
  );
}

/* ── Print preview pager ── a popup that cycles through every real printed
   page (Main JSA, each Continuation, each Sign-In), not just page 1 (Fonzo,
   2026-08-17/18: "preview should just be a pop up where u can cycle between
   pages"). Reuses the exact same print components PrintableJsa assembles for
   the real export (MainJsaDocumentPage/TaskContinuationPage/AttachedSignIn)
   so what's shown here can't drift from what actually prints -- see
   PrintableJsa above for the authoritative page-assembly logic this
   mirrors. AttachedSignIn's indexOffset/signInTotal props exist specifically
   so a single extracted sign-in page still reads "Attached Sign-In 3 of 4"
   instead of "1 of 1". */
function JsaPreviewPagerModal({ jsa, plan, initialIndex = 0, onClose }) {
  const dialogRef = useFocusTrapDialog(onClose);
  const viewportRef = useRef(null);
  const [scale, setScale] = useState(0.7);
  const [pageIdx, setPageIdx] = useState(initialIndex);

  const pages = useMemo(() => [
    { kind: 'main', label: 'Main JSA' },
    ...plan.continuationPages.map((rows, idx) => ({
      kind: 'continuation', rows, idx,
      label: `Continuation ${idx + 1} of ${plan.continuationPages.length}`,
    })),
    ...plan.signInPages.map((lines, idx) => ({
      kind: 'signin', lines, idx,
      label: `Sign-In ${idx + 1} of ${plan.signInPages.length}`,
    })),
  ], [plan]);
  const total = pages.length;
  const clamped = Math.min(Math.max(0, pageIdx), total - 1);
  const current = pages[clamped];
  const goPrev = () => setPageIdx(i => Math.max(0, i - 1));
  const goNext = () => setPageIdx(i => Math.min(total - 1, i + 1));

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => {
      const width = Math.max(200, node.clientWidth - 28);
      const height = Math.max(200, node.clientHeight - 28);
      setScale(Math.min(1, width / 816, height / 1056));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Arrow-key paging, on top of useFocusTrapDialog's own Escape/Tab handling.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [total]);

  // Portaled straight to document.body -- this modal is opened from inside
  // the live preview panel (.workflowRight), which is itself a positioned
  // (sticky) element and so establishes its own stacking context. Without
  // the portal, this dialog's z-index only ever competed against its own
  // siblings inside that panel, not against the rest of the page -- in
  // practice the sticky StepNav bar (z-index:5) painted on top of this
  // "fullscreen" modal despite its z-index:300, because the whole
  // .workflowRight subtree sits at the default (z-index:auto) paint layer
  // one level up. Confirmed via computed-style ancestor walk, not guessed
  // (Fonzo screenshot, 2026-08-31). Every other dialog in this file already
  // avoids this by living outside .workflowRight in the component tree.
  return createPortal(
    <div className="dialogOverlay previewPagerOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialogPanel previewPagerPanel" role="dialog" aria-modal="true" aria-label="Print preview" ref={dialogRef}>
        <div className="previewPagerHead">
          <span className="previewPagerLabel"><strong>{current.label}</strong> <span className="previewPagerCount">Page {clamped + 1} of {total}</span></span>
          <button type="button" className="actionSheetCloseBtn" onClick={onClose} aria-label="Close preview">✕</button>
        </div>
        <div className="previewSheetViewport previewPagerViewport" ref={viewportRef}>
          <div className="previewSheetCanvas" style={{ transform: `scale(${scale})` }}>
            <div className="previewDefaultMargin">
              {current.kind === 'main' && <MainJsaDocumentPage jsa={jsa} plan={plan} className="previewDocumentPage" />}
              {current.kind === 'continuation' && (
                <TaskContinuationPage
                  jsa={jsa}
                  rows={current.rows}
                  pageNumber={2 + current.idx}
                  totalPages={plan.totalPages}
                  continuationNumber={current.idx + 1}
                  continuationTotal={plan.continuationPages.length}
                  className="documentPage"
                />
              )}
              {current.kind === 'signin' && (
                <AttachedSignIn
                  jsa={jsa}
                  pages={[current.lines]}
                  indexOffset={current.idx}
                  signInTotal={plan.signInPages.length}
                  pageOffset={1 + plan.continuationPages.length}
                  totalPages={plan.totalPages}
                  className="documentPage"
                />
              )}
            </div>
          </div>
        </div>
        <div className="previewPagerNav">
          <button type="button" className="btn ghost sm" onClick={goPrev} disabled={clamped === 0}>‹ Prev</button>
          <div className="previewPagerDots" aria-hidden="true">
            {pages.map((_, i) => <span key={i} className={`previewPagerDot${i === clamped ? ' active' : ''}`} />)}
          </div>
          <button type="button" className="btn ghost sm" onClick={goNext} disabled={clamped === total - 1}>Next ›</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Quick panel (details/summary) ── */
function QuickPanel({ title, groups, onPick, onRemove, existingValue = '', itemType = 'item', forceOpen = false, mode = 'list' }) {
  const isTouchPrimary = useIsTouchPrimary();
  const keyBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const recentKey = `sdc.quick.recent.${keyBase}`;
  const favoriteKey = `sdc.quick.favorites.${keyBase}`;
  const [recent, setRecent] = useState(() => safeJson(localStorage.getItem(recentKey), []));
  const [favorites, setFavorites] = useState(() => safeJson(localStorage.getItem(favoriteKey), []));
  const baseGroups = Array.isArray(groups) ? groups : [];
  const availableGroups = [
    ...(favorites.length ? [{ title: 'Favorites', items: favorites }] : []),
    ...(recent.length ? [{ title: 'Recently Used', items: recent }] : []),
    ...baseGroups,
  ];
  const [active, setActive] = useState(availableGroups[0]?.title || '');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!availableGroups.some(group => group.title === active)) setActive(availableGroups[0]?.title || '');
  }, [favorites.length, recent.length, groups]);

  const group = availableGroups.find(g => g.title === active) || availableGroups[0] || { title: '', items: [] };
  const allItems = baseGroups.flatMap(g => g.items || []);
  const sourceItems = search.trim() ? allItems : group.items;
  const seen = new Set();
  const filtered = sourceItems.filter(item => {
    const label = typeof item === 'string' ? item : item.label;
    const key = normalizeEntry(label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return key.includes(normalizeEntry(search));
  });
  const existing = splitLines(existingValue);
  function isItemIncluded(label) {
    return mode === 'single'
      ? normalizeEntry(existingValue) === normalizeEntry(label)
      : existing.some(value => normalizeEntry(value) === normalizeEntry(label));
  }

  function pick(item) {
    const label = typeof item === 'string' ? item : item.label;
    if (isItemIncluded(label) && onRemove) {
      onRemove(item);
      return;
    }
    const next = [label, ...recent.filter(value => normalizeEntry(value) !== normalizeEntry(label))].slice(0, 10);
    setRecent(next);
    localStorage.setItem(recentKey, JSON.stringify(next));
    onPick(item);
  }

  function toggleFavorite(event, item) {
    event.preventDefault();
    event.stopPropagation();
    const label = typeof item === 'string' ? item : item.label;
    const included = favorites.some(value => normalizeEntry(value) === normalizeEntry(label));
    const next = included
      ? favorites.filter(value => normalizeEntry(value) !== normalizeEntry(label))
      : [label, ...favorites].slice(0, 20);
    setFavorites(next);
    localStorage.setItem(favoriteKey, JSON.stringify(next));
  }

  return (
    <details className="quickPanel" open={forceOpen || !isTouchPrimary}>
      <summary>{title}</summary>
      <div className="quickPickerInner">
        <div className="quickControls">
          <div className="quickField">
            <span>Category</span>
            <select value={active} onChange={e => { setActive(e.target.value); setSearch(''); }}>
              {availableGroups.map(g => <option key={g.title} value={g.title}>{g.title}</option>)}
            </select>
          </div>
          <div className="quickField">
            <span>Search all {itemType}s</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${itemType}s`} />
          </div>
        </div>
        <div className="chipGroup">
          {filtered.length ? filtered.map(item => {
            const label = typeof item === 'string' ? item : item.label;
            const isFavorite = favorites.some(value => normalizeEntry(value) === normalizeEntry(label));
            const isIncluded = isItemIncluded(label);
            return (
              <div className={`quickChipWrap${isIncluded ? ' included' : ''}`} key={label}>
                <button
                  className="chip"
                  onClick={() => pick(item)}
                  aria-pressed={isIncluded}
                  title={isIncluded ? `Included; tap to remove ${label}` : `Add ${label}`}
                >
                  <span>{label}</span>
                  {isIncluded && <small>✓ Included</small>}
                </button>
                <button className={`favoriteBtn${isFavorite ? ' active' : ''}`} onClick={event => toggleFavorite(event, item)} aria-label={isFavorite ? `Remove ${label} from favorites` : `Add ${label} to favorites`} title={isFavorite ? 'Remove favorite' : 'Favorite'}>★</button>
              </div>
            );
          }) : <p className="noResults">No items match that search.</p>}
        </div>
      </div>
    </details>
  );
}

/* ── Primitive form fields ── */
function F({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  );
}
function TA({ label, value, onChange, onBlur, rows = 4, placeholder = '', voice = false, voiceMode = 'narrative' }) {
  // Content-aware height: grows with typed content up to a CSS max-height,
  // then scrolls internally. Resizing style.height doesn't touch the value
  // or selection, so it never causes a cursor jump.
  const ref = useRef(null);
  const labelId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <label className="field">
      <div className="fieldLabelRow">
        <span id={labelId}>{label}</span>
        {voice && <SpeakButton value={value} onChange={onChange} mode={voiceMode} />}
      </div>
      <textarea ref={ref} rows={rows} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onBlur} className="autoGrow" aria-labelledby={voice ? labelId : undefined} />
    </label>
  );
}

// One-item-at-a-time entry field for JSA Tasks/Hazards/Controls: type an
// entry, hit Enter, it becomes a removable row and the input clears for the
// next one. `value`/`onChange` stay the same newline-joined string the rest
// of the app (splitLines, voice dictation's list mode, PDF pipeline) already
// reads and writes -- this only changes how a human types into it, not the
// data shape. Fuzzy near-duplicate cleanup (dedupeList) runs from the live
// `value` prop, never a closed-over copy, so it can't clobber an entry that
// was just committed in the same event.
function ChipEntryTA({ label, value, onChange, placeholder = '', voice = false, voiceMode = 'narrative' }) {
  const [draft, setDraft] = useState('');
  const labelId = useId();
  const inputRef = useRef(null);
  const items = splitLines(value);

  function commit() {
    const text = draft.trim();
    if (!text) return;
    onChange(addExactEntry(value, text).value);
    setDraft('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && items.length) {
      // Empty input + backspace pulls the last entry back into the input to
      // fix a typo, instead of silently deleting it.
      e.preventDefault();
      const last = items[items.length - 1];
      onChange(removeExactEntry(value, last));
      setDraft(last);
    }
  }

  function handleBlur() {
    const text = draft.trim();
    const merged = text ? addExactEntry(value, text).value : value;
    const cleaned = dedupeList(splitLines(merged)).join('\n');
    if (cleaned !== value) onChange(cleaned);
    setDraft('');
  }

  return (
    <div className="field chipEntryField">
      <div className="fieldLabelRow">
        <span id={labelId}>{label}</span>
        {voice && <SpeakButton value={value} onChange={onChange} mode={voiceMode} />}
      </div>
      {items.length > 0 && (
        <ul className="chipEntryList">
          {items.map((item, i) => (
            <li className="chipEntryRow" key={`${item}-${i}`}>
              <button type="button" className="chipEntryText" onClick={() => { onChange(removeExactEntry(value, item)); setDraft(item); inputRef.current?.focus(); }} title="Tap to edit">
                {item}
              </button>
              <button type="button" className="chipEntryRemove" onClick={() => onChange(removeExactEntry(value, item))} aria-label={`Remove ${item}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="text"
        className="chipEntryInput"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={items.length ? 'Add another…' : placeholder}
        aria-labelledby={labelId}
      />
    </div>
  );
}

/* ── PrintableJsa ── */
function PrintBrandHeader({ title, subtitle, pageNumber, totalPages }) {
  return (
    <header className="printBrandHeader">
      <div className="printBrandBar">
        <img src={SHACKELFORD_LOGO} alt="Shackelford Construction and Hauling" />
        <div className="printBrandTitles">
          <h1>{title}</h1>
          <h2>{subtitle}</h2>
        </div>
        <div className="printPageNumber">Page {pageNumber} of {totalPages}</div>
      </div>
      <div className="printRedRule" />
    </header>
  );
}

function PrintTaskTable({ rows, className = '' }) {
  return (
    <table className={`printTaskTable ${className}`.trim()}>
      <thead><tr><th>Individual Task Steps</th><th>Hazards</th><th>Controls &amp; Mitigations</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{r.step}</td><td>{r.hazards}</td><td>{r.controls}</td></tr>)}</tbody>
    </table>
  );
}

function MainJsaDocumentPage({ jsa, plan, className = '', pageRef }) {
  const sigCount = signInLineTotal(jsa);
  return (
    <div className={`documentPage mainJsaPage ${className}`.trim()} ref={pageRef}>
      <PrintBrandHeader title="Job Safety Analysis" subtitle="JSA & Tailgate Meeting Form" pageNumber={1} totalPages={plan.totalPages} />
      <table className="printInfoTable">
        <tbody>
          <tr><th>Location:</th><td>{jsa.location}</td><th>Time Issued:</th><td>{jsa.timeIssued}</td><th>Date:</th><td>{dateStr(jsa.date)}</td></tr>
          <tr><th>Job Site:</th><td>{jsa.jobSite}</td><th>Time Expired:</th><td>{jsa.timeExpired}</td><th>Job #:</th><td>{jsa.jobNumber}</td></tr>
          <tr><th>Superintendent/Foreman:</th><td>{jsa.superintendentForeman}</td><th>Emergency/Rescue Phone #:</th><td>{jsa.emergencyPhone}</td><th>Client:</th><td>{jsa.client}</td></tr>
          <tr><th>Nearest Medical Facility:</th><td>{jsa.nearestMedicalFacility}</td><th>Site Contact Phone #:</th><td>{jsa.siteContactPhone}</td><th>Muster Point:</th><td>{jsa.musterPoint}</td></tr>
        </tbody>
      </table>
      <div className="ackBlock"><strong>Subcontractors/Employee(s) Acknowledgement:</strong> {jsa.acknowledgement}</div>
      <div className="attachedSignInNotice"><strong>Sign-In:</strong> Attached sign-in sheet generated for {sigCount} signatures.</div>
      <table className="printSimpleTable">
        <tbody>
          <tr><th>Assigned Mentor &amp; SSE Number:</th><td>{jsa.assignedMentorSse}</td></tr>
          <tr><th>Tailgate Safety Topic:</th><td>{jsa.tailgateTopic}</td></tr>
          <tr><th>Near Miss, Incidents, Injuries Previous Day:</th><td>{jsa.previousDaySafety}</td></tr>
          <tr><th>List Overall Work Task or Activity:</th><td>{jsa.overallWorkTask}</td></tr>
        </tbody>
      </table>
      <section className="energyBox">
        <h3>Potential Sources of Energy / Hazards to Consider</h3>
        <div className="energyGrid">
          <p><strong>Gravity:</strong> Slips, trips, falls; housekeeping; falling objects; working at height; cave-in; suspended loads.</p>
          <p><strong>Motion:</strong> Caught in/on/between; rotating equipment; moving equipment; heavy equipment; body positioning; vehicle/equipment movement.</p>
          <p><strong>Mechanical:</strong> Rotating equipment; drive belts; conveyors; motors; compressed springs; tools.</p>
          <p><strong>Electrical:</strong> Shock; high voltage; overhead power lines; lightning; energized equipment; wiring; batteries.</p>
          <p><strong>Pressure:</strong> Pneumatic/hydraulic; stored energy; compressed cylinders; hoses; fluids and gases.</p>
          <p><strong>Temperature:</strong> Hot/cold surfaces; weather; open flame; heat/cold stress.</p>
          <p><strong>Chemical:</strong> Splash; inhalation; dust; fumes; corrosives; combustibles; toxic compounds.</p>
          <p><strong>Sound/Radiation/Biological:</strong> Noise; vibration; solar rays; insects; animals; contaminated water.</p>
        </div>
      </section>
      <div className="taskTableFill">
        <PrintTaskTable rows={plan.mainRows} />
      </div>
      {plan.continuationPages.length > 0 && <div className="continuationFlag">Additional task rows continue on the attached JSA continuation sheet.</div>}
      <footer className="printFooter">Shackelford Construction and Hauling, LLC · Safety First · Main JSA</footer>
    </div>
  );
}

// The JS pagination planner is responsible for guaranteeing every .printPage
// fits its fixed physical box; overflow here means the planner under-counted
// something. Rather than let CSS overflow silently clip (or, worse, let it
// stay visible and risk WebKit opening an extra physical page — the original
// doubled-page bug), this checks the real rendered boxes at the moment the
// browser is about to print and warns loudly so a planner regression is
// caught instead of silently mis-printing in the field.
//
// Container-level overflow (scrollHeight vs clientHeight) only catches
// content that got PUSHED OUT of its box — it cannot detect a table that was
// forcibly squeezed to fit exactly (no overflow, because nothing stuck out,
// but individual rows below their intended minimum height). That was
// confirmed on physical iPad Safari as a real, distinct failure mode this
// check alone would have missed, so this also measures the last few rows of
// every task table directly against the CSS floor (PRINT_TASK_ROW_MIN_PX)
// and reports them separately from container overflow.
const PRINT_PX_PER_IN = 96; // CSS reference pixel, per spec — used only to
// convert measured px back to inches for human-readable reporting.
const PRINT_TASK_ROW_MIN_PX = 24; // must match .printTaskTable td min-height in styles.css
function measurePrintPages(root) {
  if (!root) return [];
  const sheets = Array.from(root.querySelectorAll('.printSheet'));
  return sheets.map((sheetEl, index) => {
    const el = sheetEl.querySelector('.printPage');
    let type = 'unknown';
    if (el.classList.contains('mainJsaPage')) type = 'main';
    else if (el.classList.contains('continuationPage')) type = 'continuation';
    else if (el.classList.contains('signInPage')) type = 'signin';
    const sheetRect = sheetEl.getBoundingClientRect();
    const sheetCs = window.getComputedStyle(sheetEl);
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const rows = Array.from(el.querySelectorAll('.printTaskTable tbody tr'));
    const allRowHeights = rows.map(tr => Math.round(tr.getBoundingClientRect().height * 10) / 10);
    const lastRows = rows.slice(-5).map(tr => {
      const h = tr.getBoundingClientRect().height;
      return { heightPx: Math.round(h * 10) / 10, belowMinimum: h < PRINT_TASK_ROW_MIN_PX };
    });
    const footer = el.querySelector('.printFooter');
    const footerRect = footer ? footer.getBoundingClientRect() : null;
    const headerCells = Array.from(el.querySelectorAll('.printTaskTable thead th'));
    const columnWidths = headerCells.map(th => {
      const w = th.getBoundingClientRect().width;
      return { widthPx: Math.round(w * 10) / 10, widthPct: Math.round((w / rect.width) * 1000) / 10 };
    });
    return {
      index,
      type,
      sheetWidthPx: Math.round(sheetRect.width * 10) / 10,
      sheetHeightPx: Math.round(sheetRect.height * 10) / 10,
      breakBefore: sheetCs.breakBefore,
      breakAfter: sheetCs.breakAfter,
      pageBreakBefore: sheetCs.pageBreakBefore,
      pageBreakAfter: sheetCs.pageBreakAfter,
      outerWidthPx: Math.round(rect.width * 10) / 10,
      outerHeightPx: Math.round(rect.height * 10) / 10,
      outerWidthIn: Math.round((rect.width / PRINT_PX_PER_IN) * 100) / 100,
      outerHeightIn: Math.round((rect.height / PRINT_PX_PER_IN) * 100) / 100,
      paddingPx: { top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) },
      borderPx: { top: parseFloat(cs.borderTopWidth), right: parseFloat(cs.borderRightWidth), bottom: parseFloat(cs.borderBottomWidth), left: parseFloat(cs.borderLeftWidth) },
      // Effective margin from the physical sheet edge to the JSA form's
      // outer border — the number that actually matters visually, since
      // nothing else in the ancestor chain (.printOnly, .printSheet) adds
      // any inset of its own; this equals the padding above by construction.
      effectiveMarginPx: {
        left: Math.round((rect.left - sheetRect.left) * 10) / 10,
        top: Math.round((rect.top - sheetRect.top) * 10) / 10,
        right: Math.round((sheetRect.right - rect.right) * 10) / 10,
        bottom: Math.round((sheetRect.bottom - rect.bottom) * 10) / 10,
      },
      boxSizing: cs.boxSizing,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowXPx: el.scrollWidth - el.clientWidth,
      overflowYPx: el.scrollHeight - el.clientHeight,
      rowCount: rows.length,
      allRowHeights,
      lastRows,
      minRowHeightPx: lastRows.length ? Math.min(...lastRows.map(r => r.heightPx)) : null,
      anyRowBelowMinimum: lastRows.some(r => r.belowMinimum),
      columnWidths,
      footerTopPx: footerRect ? Math.round((footerRect.top - rect.top) * 10) / 10 : null,
      footerBottomPx: footerRect ? Math.round((footerRect.bottom - rect.top) * 10) / 10 : null,
    };
  });
}

// Shared module-level store: beforeprint only fires when the user actually
// triggers Print/Print Preview, so this is the only point real (not
// Chromium-emulated) layout numbers are ever available. PrintDebugPanel
// subscribes to this so a user can print once, then check ?debug=print for
// what really happened — this cannot be populated ahead of time.
let lastPrintDiagnostics = null;
const printDiagnosticsListeners = new Set();
function setPrintDiagnostics(data) {
  lastPrintDiagnostics = data;
  printDiagnosticsListeners.forEach(fn => fn(data));
}
function usePrintDiagnostics() {
  const [data, setData] = useState(lastPrintDiagnostics);
  useEffect(() => {
    printDiagnosticsListeners.add(setData);
    return () => printDiagnosticsListeners.delete(setData);
  }, []);
  return data;
}

// Shared module-level store for real rendered-height pagination
// measurements — same subscribe pattern as the print-diagnostics store
// above. Unlike that store, this one is populated continuously (every time
// PaginationMeasureRig's hidden DOM settles after a jsa change), not only
// on an actual print action, since pagination decisions have to be correct
// *before* the user ever opens Print.
let lastPageMeasurements = null;
const pageMeasurementsListeners = new Set();
function setPageMeasurements(data) {
  lastPageMeasurements = data;
  pageMeasurementsListeners.forEach(fn => fn(data));
}
function getLatestPageMeasurements() { return lastPageMeasurements; }
function usePageMeasurements() {
  const [data, setData] = useState(lastPageMeasurements);
  useEffect(() => {
    pageMeasurementsListeners.add(setData);
    return () => pageMeasurementsListeners.delete(setData);
  }, []);
  return data;
}
// The one hook everything interactive should use for a page plan: prefers
// real measurements, falls back to the heuristic automatically (via
// resolvePagePlan) whenever they aren't available yet.
function useJsaPagePlan(jsa) {
  const measurements = usePageMeasurements();
  return useMemo(() => resolvePagePlan(jsa, measurements), [jsa, measurements]);
}

/* Hidden, permanently-mounted rig that measures real rendered heights for
   pagination — see buildMeasuredPlan above. Renders the exact same
   MainJsaDocumentPage / TaskContinuationPage components used for real
   printing (guaranteeing 1:1 fidelity with what will actually print), with
   ALL content rows unpaginated in one table, inside a hidden-but-laid-out
   (not display:none) container sized with the same absolute units
   (.printMeasureRoot in styles.css) that print itself uses — CSS absolute
   units resolve identically whether the browser is currently rendering for
   screen or print, so this is a real measurement, not a simulation.
   Limitation: this can only ever be as accurate as Chromium's box model:
   it cannot account for anything genuinely Safari/AirPrint-specific (font
   metrics, hardware margins) that this repo cannot verify without physical
   hardware — the same limitation as every other diagnostic in this file. */
function PaginationMeasureRig({ jsa }) {
  const rows = useMemo(() => getContentRows(jsa), [jsa]);
  const mainRef = useRef(null);
  const continuationRef = useRef(null);

  useLayoutEffect(() => {
    if (!rows.length) return; // trivial case; buildMeasuredPlan skips measurement for it anyway
    // .printMeasureRoot is display:none under real @media print (it must
    // never appear as printed content). If this effect ever re-runs while
    // print media is active (e.g. jsa's reference changes for any reason —
    // autosave, a suggestion update — at the exact moment a real print
    // action or print preview is open), every getBoundingClientRect() call
    // below would return an all-zero rect (display:none has no layout box
    // at all), publishing garbage measurements that would silently corrupt
    // the plan being used for the print already in progress. Confirmed by
    // direct testing: this is a real, reachable failure mode, not
    // theoretical. Skip entirely rather than publish bad data — whatever
    // was already measured (from the last time print media was NOT active)
    // stays in place and keeps being used.
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('print').matches) return;
    const mainRoot = mainRef.current;
    const continuationRoot = continuationRef.current;
    if (!mainRoot || !continuationRoot) return;

    const firstRowOffset = (root) => {
      const pageEl = root.querySelector('.printPage');
      const firstTr = pageEl && pageEl.querySelector('.printTaskTable tbody tr');
      if (!pageEl || !firstTr) return null;
      return firstTr.getBoundingClientRect().top - pageEl.getBoundingClientRect().top;
    };
    const footerHeight = (root) => {
      const footer = root.querySelector('.printFooter');
      return footer ? footer.getBoundingClientRect().height : 0;
    };

    const mainFirstRowOffsetPx = firstRowOffset(mainRoot);
    const mainFooterHeightPx = footerHeight(mainRoot);
    const continuationFirstRowOffsetPx = firstRowOffset(continuationRoot);
    const continuationFooterHeightPx = footerHeight(continuationRoot);
    // Measured in its real context (rendered inside the main page's own flex
    // column, at the real 7.1in content width) rather than standalone --
    // confirmed by direct measurement that an isolated/unconstrained-width
    // copy of this banner could wrap its text differently than it does in
    // place, under- or over-counting its real height.
    const flagEl = mainRoot.querySelector('.continuationFlag');
    const continuationFlagHeightPx = flagEl ? flagEl.getBoundingClientRect().height + parseFloat(window.getComputedStyle(flagEl).marginTop || '0') : 0;
    // Measured separately per table, NOT reused between them: continuation
    // rows have a taller floor (35px, .continuationTaskTable td) than main
    // rows (24px, .printTaskTable td) -- confirmed by direct measurement
    // that reusing one set of heights for both caused real, growing
    // overflow on continuation pages as row counts increased (the taller
    // real continuation rows needed more room than the shorter
    // main-table-measured heights had budgeted for).
    const rowHeightsPx = Array.from(mainRoot.querySelectorAll('.printTaskTable tbody tr')).map(tr => tr.getBoundingClientRect().height);
    const continuationRowHeightsPx = Array.from(continuationRoot.querySelectorAll('.printTaskTable tbody tr')).map(tr => tr.getBoundingClientRect().height);

    if (mainFirstRowOffsetPx == null || continuationFirstRowOffsetPx == null) return;

    setPageMeasurements({
      fingerprint: fingerprintPaginationInput(jsa),
      mainFirstRowOffsetPx,
      mainFooterHeightPx,
      continuationFirstRowOffsetPx,
      continuationFooterHeightPx,
      continuationFlagHeightPx,
      rowHeightsPx,
      continuationRowHeightsPx,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsa, rows]);

  if (!rows.length) return null;

  // continuationPages is a non-empty placeholder (not the real plan) purely
  // so MainJsaDocumentPage renders its continuation-notice banner here too
  // -- its real height (in its real position/width) is reserved out of
  // mainAvailablePx below, defensively, on every measurement regardless of
  // whether the final plan actually ends up needing a continuation page.
  const measurePlan = { totalPages: 1, mainRows: rows, continuationPages: [{}] };
  return (
    <div className="printMeasureRoot" aria-hidden="true">
      <div ref={mainRef}>
        <MainJsaDocumentPage jsa={jsa} plan={measurePlan} className="printPage" />
      </div>
      <div ref={continuationRef}>
        <TaskContinuationPage jsa={jsa} rows={rows} pageNumber={2} totalPages={2} continuationNumber={1} continuationTotal={1} />
      </div>
    </div>
  );
}

/* Off-screen root rendering the FINAL, already-paginated plan (unlike
   PaginationMeasureRig, which renders raw unpaginated content) — one
   fixed-size Letter .printPage per logical page, using the exact same
   components/data/columns/typography/headers/footers as real printing.
   generateJsaPdf (below) captures each page here directly into a PDF —
   see the .pdfExportRoot comment in styles.css for why this exists at all:
   physical iPad Safari repeatedly fragmented every logical page into two
   physical pages despite this repo's automated tooling verifying clean
   geometry every time, across several structurally different CSS
   approaches. This sidesteps browser print pagination entirely for the
   primary export path rather than continuing to chase that bug blind.
   Always mounted (same pattern as PaginationMeasureRig/PrintableJsa) so
   it's ready the instant the user taps Print / Save PDF — no extra mount
   -and-settle render cycle needed first. pageRefsRef is populated in
   logical page order every render so generateJsaPdf can read it directly. */
function PdfExportRoot({ jsa, plan, pageRefsRef }) {
  const mainRef = useRef(null);
  const continuationRefs = useRef([]);
  const signInRefs = useRef([]);

  useLayoutEffect(() => {
    const ordered = [];
    if (mainRef.current) ordered.push({ type: 'main', el: mainRef.current });
    plan.continuationPages.forEach((_, i) => {
      if (continuationRefs.current[i]) ordered.push({ type: 'continuation', el: continuationRefs.current[i] });
    });
    plan.signInPages.forEach((_, i) => {
      if (signInRefs.current[i]) ordered.push({ type: 'signin', el: signInRefs.current[i] });
    });
    pageRefsRef.current = ordered;
  });

  return (
    <div className="pdfExportRoot" aria-hidden="true">
      <MainJsaDocumentPage jsa={jsa} plan={plan} className="printPage" pageRef={mainRef} />
      {plan.continuationPages.map((rows, idx) => (
        <TaskContinuationPage
          key={idx}
          jsa={jsa}
          rows={rows}
          pageNumber={2 + idx}
          totalPages={plan.totalPages}
          continuationNumber={idx + 1}
          continuationTotal={plan.continuationPages.length}
          pageRef={el => { continuationRefs.current[idx] = el; }}
        />
      ))}
      <AttachedSignIn
        jsa={jsa}
        pages={plan.signInPages}
        pageOffset={1 + plan.continuationPages.length}
        totalPages={plan.totalPages}
        getPageRef={(idx, el) => { signInRefs.current[idx] = el; }}
      />
    </div>
  );
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* Capture-only compensation for a stable html2canvas rendering quirk:
   confirmed by direct pixel measurement (native DOM vs. html2canvas capture
   of the identical live DOM, in both Chromium and WebKit) that html2canvas
   paints compact single-line table-cell text a few pixels lower than the
   browser's own layout — never in the live preview or legacy browser-print
   path, which don't go through html2canvas and render this text correctly
   already. Wraps only genuinely single-line, non-blank cell text in a span
   that .pdfExportRoot shifts upward at capture time (see .pdfSingleLineText
   in styles.css); wrapped multi-line values (Job Site, Client, etc. when
   long) and blank cells are left completely untouched — shifting wrapped
   text would undo the b11e2bc line-height clipping fix's safety margin.
   Single-vs-wrapped is measured live via Range.getClientRects() (exactly 1
   rect = one visual line) rather than assumed from character count or label
   text, because real column widths already wrap some labels (e.g.
   "Emergency/Rescue Phone #:") that would be wrong to shift.
   Purely additive and reversible: returns a cleanup function that must be
   called (via try/finally) immediately after this page's html2canvas
   capture, success or failure, so the mutation never outlives a single
   page's capture and can never accumulate across repeated exports. */
function prepareSingleLineTextForCapture(pageEl) {
  const cells = pageEl.querySelectorAll(
    '.printInfoTable th, .printInfoTable td, .printSimpleTable th, .printSimpleTable td'
  );
  const wrappedSpans = [];
  cells.forEach((cell) => {
    if (cell.querySelector('.pdfSingleLineText')) return; // already prepared -- never double-wrap
    const textNode = Array.from(cell.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    );
    if (!textNode) return; // blank cell -- nothing to shift

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const isSingleLine = range.getClientRects().length === 1;
    if (!isSingleLine) return; // wrapped content -- must never be shifted

    const span = document.createElement('span');
    span.className = 'pdfSingleLineText';
    cell.insertBefore(span, textNode);
    span.appendChild(textNode);
    wrappedSpans.push(span);
  });

  return function cleanupSingleLineTextCapture() {
    wrappedSpans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
  };
}

/* The deterministic PDF export pipeline (Phase 4B). Captures each logical
   page from PdfExportRoot sequentially — one canvas at a time, released
   before starting the next — and assembles them into a single PDF with
   pdf-lib, entirely client-side. No browser print pagination is involved
   at any point. onProgress(pageIndex, totalPages) is called before each
   page capture starts, for UI progress display. Throws with a descriptive
   message on any failure (caller is responsible for showing it to the
   user) rather than silently producing a broken/partial PDF. */
async function generateJsaPdf(pageRefsRef, onProgress) {
  const pages = pageRefsRef.current;
  if (!pages.length) throw new Error('No pages to export — the document plan is empty.');

  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* non-fatal: proceed with whatever is loaded */ }
  }
  // At least one settled animation frame after the export root's latest
  // render, so layout has fully committed before the first capture.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const isTouchPrimary = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches;
  const scale = isTouchPrimary ? 2 : 2.5; // keep mobile Safari canvases smaller to avoid memory pressure

  const pdfDoc = await PDFDocument.create();
  const PT_PER_IN = 72;
  const LETTER_WIDTH_PT = 8.5 * PT_PER_IN;
  const LETTER_HEIGHT_PT = 11 * PT_PER_IN;

  for (let i = 0; i < pages.length; i += 1) {
    const { type, el } = pages[i];
    onProgress?.(i + 1, pages.length);
    if (!el) throw new Error(`Page ${i + 1} of ${pages.length} (${type}) did not render — export aborted.`);

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error(`Page ${i + 1} of ${pages.length} (${type}) has no measurable size — export aborted.`);
    }

    const cleanupSingleLineText = prepareSingleLineTextForCapture(el);
    let canvas;
    try {
      canvas = await html2canvas(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
    } catch (err) {
      throw new Error(`Failed to render page ${i + 1} of ${pages.length} (${type}): ${err?.message || err}`);
    } finally {
      cleanupSingleLineText();
    }
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error(`Page ${i + 1} of ${pages.length} (${type}) captured empty — export aborted.`);
    }

    const pngBytes = dataUrlToUint8Array(canvas.toDataURL('image/png'));
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const pdfPage = pdfDoc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: LETTER_WIDTH_PT, height: LETTER_HEIGHT_PT });

    // Release this page's canvas before moving to the next — never hold
    // more than one full-resolution capture in memory at a time.
    canvas.width = 0;
    canvas.height = 0;
    canvas = null;
  }

  const pdfBytes = await pdfDoc.save();

  // Validate before returning: reopen the bytes we actually produced and
  // confirm the page count matches the logical plan exactly. A mismatch
  // means silent data loss and must be treated as a hard failure, not a
  // PDF the user is allowed to print or share.
  const verifyDoc = await PDFDocument.load(pdfBytes);
  const pageCount = verifyDoc.getPageCount();
  if (pageCount !== pages.length) {
    throw new Error(`Generated PDF has ${pageCount} pages but the plan has ${pages.length} — export aborted.`);
  }

  return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), pageCount };
}

/* STEP 2 of the two-step export flow — must be called directly from a user
   click/tap handler with NO awaited work before navigator.share(), and
   given an ALREADY-generated File (never regenerates). This is not
   stylistic: navigator.share() requires "transient user activation", which
   expires a few seconds after the triggering input event. PDF generation
   itself involves multiple awaited operations (canvas capture per page,
   PDF assembly) that can easily take longer than that window, so calling
   share() automatically right after generation finishes can fail with
   NotAllowedError even though the user very much did just tap a button —
   the activation from that ORIGINAL tap has already expired by the time
   generation completes. Splitting generation (Step 1) from share (Step 2,
   its own fresh tap) sidesteps this entirely: this function's own click
   handler IS the fresh activation navigator.share() needs.
   navigator.canShare() is a feature/support check, not proof activation is
   still live — real proof only comes from calling share() itself inside a
   handler with no intervening await, which is what this does. */
function shareGeneratedPdf(file) {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return { ok: false, reason: 'Sharing is not supported on this browser — use Download PDF instead.' };
  }
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    return { ok: false, reason: 'Sharing this file is not supported on this browser — use Download PDF instead.' };
  }
  // Fire-and-report: the caller does not await this promise before
  // returning control to the click handler (nothing here does), so the
  // share() call itself is what carries the activation, not anything
  // awaited beforehand.
  const sharePromise = navigator.share({ files: [file], title: file.name });
  return { ok: true, promise: sharePromise };
}

/* STEP: Download PDF — always uses the already-generated Blob, never
   regenerates. Deliberately NOT an automatic fallback for a cancelled or
   failed share (the user explicitly asked that a cancelled/failed share
   must not silently trigger a download) — only ever runs from its own
   dedicated button. */
function downloadGeneratedPdf(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function PrintableJsa({ jsa }) {
  const plan = useJsaPagePlan(jsa);
  const rootRef = useRef(null);

  useEffect(() => {
    const handler = () => {
      const pages = measurePrintPages(rootRef.current);
      setPrintDiagnostics({ capturedAt: new Date().toISOString(), pages });
      const overflowing = pages.filter(p => p.overflowYPx > 0 || p.overflowXPx > 0);
      if (overflowing.length) {
        console.warn(
          `[print] ${overflowing.length} page(s) exceeded the physical page box — pagination planner under-counted content`,
          overflowing,
        );
      }
      const compressed = pages.filter(p => p.anyRowBelowMinimum);
      if (compressed.length) {
        console.warn(
          `[print] ${compressed.length} page(s) have task rows below the ${PRINT_TASK_ROW_MIN_PX}px minimum row height — rows are being compressed`,
          compressed,
        );
      }
    };
    window.addEventListener('beforeprint', handler);
    return () => window.removeEventListener('beforeprint', handler);
  }, []);

  return (
    <div className="printOnly" ref={rootRef}>
      <section className="printSheet">
        <MainJsaDocumentPage jsa={jsa} plan={plan} className="printPage" />
      </section>

      {plan.continuationPages.map((rows, idx) => (
        <section className="printSheet" key={idx}>
          <TaskContinuationPage
            jsa={jsa}
            rows={rows}
            pageNumber={2 + idx}
            totalPages={plan.totalPages}
            continuationNumber={idx + 1}
            continuationTotal={plan.continuationPages.length}
          />
        </section>
      ))}

      <AttachedSignIn
        jsa={jsa}
        pages={plan.signInPages}
        pageOffset={1 + plan.continuationPages.length}
        totalPages={plan.totalPages}
      />
    </div>
  );
}

function TaskContinuationPage({ jsa, rows, pageNumber, totalPages, continuationNumber, continuationTotal, pageRef, className = '' }) {
  return (
    <div className={`printPage continuationPage ${className}`.trim()} ref={pageRef}>
      <PrintBrandHeader title="JSA Continuation Sheet" subtitle={`Continuation ${continuationNumber} of ${continuationTotal}`} pageNumber={pageNumber} totalPages={totalPages} />
      <table className="printInfoTable continuationInfoTable">
        <tbody>
          <tr><th>Job Site:</th><td>{jsa.jobSite}</td><th>Date:</th><td>{dateStr(jsa.date)}</td><th>Job #:</th><td>{jsa.jobNumber}</td></tr>
          <tr><th>Location:</th><td>{jsa.location}</td><th>Superintendent/Foreman:</th><td>{jsa.superintendentForeman}</td><th>Overall Task:</th><td>{jsa.overallWorkTask}</td></tr>
        </tbody>
      </table>
      <div className="continuationNotice">Continuation of the task, hazard, and control table from the main JSA. Review with the crew as part of the same JSA.</div>
      <PrintTaskTable rows={rows} className="continuationTaskTable" />
      <footer className="printFooter">Shackelford Construction and Hauling, LLC · JSA Continuation</footer>
    </div>
  );
}

// Signature sizing is pure CSS now (.attachedSigLineImg in styles.css,
// height driven by the --sig-row-h custom property below) -- no JS math, no
// runtime measurement, no post-render DOM mutation. See the big comment on
// getSignaturePages/SIGNIN_ROW_HEIGHT_PX above for why: every previous
// attempt to compute a signature's size at capture time worked in this
// repo's own tests and still came out wrong for Fonzo in the field. A fixed
// row height means the CSS can size the image correctly on the very first
// render, the same way on every export path (the primary pipeline AND the
// legacy window.print() fallback), with nothing to get out of sync.
// indexOffset/signInTotal default to plain array position/length, which is
// exactly right for the real print pipeline's call (the full pages array,
// unsliced). They only need to differ when a caller passes a single
// extracted page out of the full set -- see JsaPreviewPagerModal, which
// shows one sign-in page at a time and still needs it to correctly read
// "Attached Sign-In 3 of 4", not "1 of 1".
function AttachedSignIn({ jsa, pages, pageOffset, totalPages, getPageRef, indexOffset = 0, signInTotal, className = '' }) {
  const total = signInTotal ?? pages.length;
  return (
    <>
      {pages.map((lines, localIdx) => {
        const pageIdx = localIdx + indexOffset;
        return (
        <section className="printSheet" key={pageIdx}>
          <div className={`printPage signInPage ${className}`.trim()} ref={getPageRef ? (el => getPageRef(pageIdx, el)) : undefined}>
            <PrintBrandHeader title="JSA Sign-In Sheet" subtitle={`Attached Sign-In ${pageIdx + 1} of ${total}`} pageNumber={pageOffset + pageIdx + 1} totalPages={totalPages} />
            <table className="printInfoTable signInInfoTable">
              <tbody>
                <tr><th>Location:</th><td>{jsa.location}</td><th>Date:</th><td>{dateStr(jsa.date)}</td><th>Job #:</th><td>{jsa.jobNumber}</td></tr>
                <tr><th>Job Site:</th><td>{jsa.jobSite}</td><th>Superintendent/Foreman:</th><td>{jsa.superintendentForeman}</td><th>Overall Task:</th><td>{jsa.overallWorkTask}</td></tr>
              </tbody>
            </table>
            <div className="ackBlock signInAck"><strong>Acknowledgement:</strong> I have reviewed and understand the JSA and tailgate meeting information and will exercise stop work authority for unsafe acts, conditions, or hazards.</div>
            <div className="attachedSignatureGrid" style={{ '--sig-row-h': `${SIGNIN_ROW_HEIGHT_PX}px` }}>
              {lines.map(({ n, dataUrl }) => (
                <div className={`attachedSigLine${dataUrl ? ' attachedSigLineDigital' : ''}`} key={n}>
                  <span className="attachedSigLineNum">{n}.</span>
                  {dataUrl && <img className="attachedSigLineImg" src={dataUrl} alt="" />}
                </div>
              ))}
            </div>
            <footer className="printFooter">Shackelford Construction and Hauling, LLC · Attached Sign-In Sheet</footer>
          </div>
        </section>
        );
      })}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
