import { useLayoutEffect, useMemo, useRef } from 'react';
import { loadPdfLibs } from '../documents/pdfLibs';
import { isIncidentPrintFinal, printedIncidentFingerprint } from './incidentModel';
import {
  IncidentPageShell, Page1Content, Page2Content, Page3Content, Page4Content, Page5Content, Page6Content, ContinuationPage,
  PhotoAppendixContent,
} from './IncidentPdf';
import { useIncidentPhotoUrls } from './useIncidentPhotoUrls';
import {
  textBlockMeasureStyle, MIN_DESCRIPTION_HEIGHT_PX, MIN_STATEMENT_HEIGHT_PX, MIN_NOTE_BOX_HEIGHT_PX,
  MIN_TEAM_ROW_HEIGHT_PX, MAX_TEAM_ROW_HEIGHT_PX, PAGE_BOTTOM_SAFETY_PX, CONTINUATION_BODY_HEIGHT_PX,
} from './incidentPdfLayout';
import { paginateText, measureNaturalHeight } from './textFit';
import { measurePage1Budget, measurePage3Budget, measurePage4Budget, measurePage6NotesBudget } from './incidentPdfMeasure';

/* Phase 2 -- Page 6's "Superintendent/Supervisor Notes & Summary" box is
   fed by two separate, plainly-worded UI prompts (Immediate Actions Taken /
   Corrective & Preventive Actions -- see IncidentWorkflow.jsx's StepNotes)
   instead of one vague combined field, but the box ITSELF is unchanged:
   this just formats both answers into the one string the existing
   measurement/pagination pipeline below already knows how to handle,
   exactly the same as the old single supervisorNotes string was. Headings
   are only included for a field that actually has content -- an empty
   field is never given a heading with nothing under it (no fabricated
   content, see the "empty/partial answers" requirement), and if both are
   blank this returns '' (same as an empty supervisorNotes did before). */
export function buildSuperintendentResponseText(incident) {
  const immediate = String(incident.immediateActionsTaken || '').trim();
  const corrective = String(incident.correctivePreventiveActions || '').trim();
  const sections = [];
  if (immediate) sections.push(`IMMEDIATE ACTIONS TAKEN:\n${immediate}`);
  if (corrective) sections.push(`CORRECTIVE / PREVENTIVE ACTIONS:\n${corrective}`);
  return sections.join('\n\n');
}

/* Every base-page flexible box (description, witness statements, page-6
   notes) is paginated the same way: fit as much as possible into the box
   height buildIncidentPagePlan() computed for it from a real measurement of
   that page's remaining space, and spill anything left to continuation
   page(s) sized for CONTINUATION_BODY_HEIGHT_PX. */
function paginateBoxText(text, firstMaxHeightPx) {
  return paginateText(text, {
    firstMaxHeightPx,
    firstStyle: textBlockMeasureStyle(),
    continuationMaxHeightPx: CONTINUATION_BODY_HEIGHT_PX,
    continuationStyle: textBlockMeasureStyle(),
  });
}

/* Splits a shared px budget between N competing boxes: if all fit at their
   full natural size, each gets at least `minEach` (this is the common case
   that used to force a wasted page 7 -- see MIN_NOTE_BOX_HEIGHT_PX). If not,
   each gets at least `minEach`, and whatever's left is divided in
   proportion to how much more than the floor each one actually needs.
   Generalizes what was previously a hand-written 2-box version (page 6's
   notes) to any number of competing boxes (also used by page 3's two
   witness statements) -- see the v0.1.2 full-page-utilization pass. */
export function allocateFlexibleSections(needs, budget, minEach) {
  const safeBudget = Math.max(0, budget);
  const totalNeed = needs.reduce((a, b) => a + b, 0);
  if (totalNeed <= safeBudget) {
    return needs.map((need) => Math.max(need, Math.min(minEach, safeBudget)));
  }
  const floor = Math.min(minEach, safeBudget / needs.length);
  const remaining = Math.max(0, safeBudget - floor * needs.length);
  const extras = needs.map((need) => Math.max(0, need - floor));
  const totalExtra = extras.reduce((a, b) => a + b, 0);
  if (totalExtra <= 0) return needs.map(() => floor);
  return extras.map((extra) => floor + (totalExtra <= remaining ? extra : remaining * (extra / totalExtra)));
}

/* Same as allocateFlexibleSections, but afterwards gives away ANY leftover
   budget (the common case where every box's actual content need is smaller
   than the floor/available space) back to the same boxes -- proportionally
   to need, so a longer statement gets more of the bonus too -- instead of
   leaving it unused. This is what makes pages 1/3/4's flexible box(es)
   stretch all the way to the page's bottom margin instead of stopping at
   whatever their own text needs (the exact "pages end halfway down the
   sheet" problem this pass fixes). Page 6 deliberately does NOT use this --
   its leftover is intentionally prioritized into growing the
   investigation-team rows first (see buildIncidentPagePlan). */
function allocateAndFillFlexibleSections(needs, budget, minEach) {
  const base = allocateFlexibleSections(needs, budget, minEach);
  const used = base.reduce((a, b) => a + b, 0);
  const leftover = Math.max(0, budget - used);
  if (leftover <= 0) return base;
  const totalNeed = needs.reduce((a, b) => a + b, 0);
  if (totalNeed <= 0) {
    const share = leftover / needs.length;
    return base.map((h) => h + share);
  }
  return base.map((h, i) => h + leftover * (needs[i] / totalNeed));
}

/* Builds the ordered list of logical pages (base pages + any continuation
   pages needed for overflowing long-text fields), plus the list of any
   field labels whose text could not be confirmed to fit (see textFit.js).
   Pure function of the incident's text content -- used both to render the
   (always-mounted, off-screen) export DOM on every relevant keystroke and,
   via getIncidentPdfOverflowFields(), as an export preflight check. */
export function buildIncidentPagePlan(incident) {
  const witnesses = incident.witnesses || [];
  const textStyle = textBlockMeasureStyle();

  // PAGE 1 -- the description box gets 100% of whatever real space is left
  // after the top info table, supervisor-contact table, and location field
  // (all data-dependent -- a long value can wrap and shrink this) render
  // with the incident's actual values (measurePage1Budget in
  // incidentPdfMeasure.js). No fixed guess: a short report leaves a large
  // blank writing box that still reaches the bottom margin; a long one uses
  // the entire real box before spilling to a continuation page.
  const page1Budget = Math.max(MIN_DESCRIPTION_HEIGHT_PX, measurePage1Budget(incident) - PAGE_BOTTOM_SAFETY_PX);
  const description = paginateBoxText(incident.detailedIncidentDescription, page1Budget);

  // PAGE 3 -- Witness 1 and Witness 2's statement boxes share whatever's
  // genuinely left after both witnesses' real contact/signature chrome
  // (measurePage3Budget), split by actual need and then stretched with any
  // remaining leftover so the two boxes together reach the bottom margin
  // (allocateAndFillFlexibleSections) instead of stopping wherever their
  // own text ends.
  const page3Budget = Math.max(0, measurePage3Budget(incident) - PAGE_BOTTOM_SAFETY_PX);
  const w1Raw = witnesses[0] ? (witnesses[0].statement || '') : 'N/A';
  const w2Raw = witnesses[1] ? (witnesses[1].statement || '') : 'N/A';
  const w1Need = measureNaturalHeight(w1Raw, textStyle);
  const w2Need = measureNaturalHeight(w2Raw, textStyle);
  const [w1BoxHeight, w2BoxHeight] = allocateAndFillFlexibleSections([w1Need, w2Need], page3Budget, MIN_STATEMENT_HEIGHT_PX);

  // PAGE 4 -- Witness 3's statement is the page's only flexible box; the
  // property-damage table (also real, data-dependent) is fixed content
  // that always renders complete. Witness 3 expands to consume whatever's
  // left above it (measurePage4Budget).
  const page4Budget = Math.max(0, measurePage4Budget(incident) - PAGE_BOTTOM_SAFETY_PX);
  const w3BoxHeight = Math.max(MIN_STATEMENT_HEIGHT_PX, page4Budget);

  const statements = [
    paginateBoxText(witnesses[0]?.statement, w1BoxHeight),
    paginateBoxText(witnesses[1]?.statement, w2BoxHeight),
    paginateBoxText(witnesses[2]?.statement, w3BoxHeight),
  ];

  // PAGE 6 -- notes get whatever they actually need first (same
  // need-based split as before -- short notes are never forced
  // artificially tall), THEN any genuine leftover is prioritized into
  // growing the investigation-team's rows (up to MAX_TEAM_ROW_HEIGHT_PX, so
  // rows never get "absurdly tall"), and only whatever the table can't use
  // goes back into the notes boxes as extra blank writing room. This is
  // what makes the table -- not empty space below it -- reach page 6's
  // bottom margin. If the notes need MORE than the budget allows, team rows
  // stay at their floor and the excess spills to a continuation page, same
  // as before.
  const supervisorText = buildSuperintendentResponseText(incident);
  const safetyConsultantText = incident.safetyConsultantNotes;
  const notesBudgetPx = Math.max(0, measurePage6NotesBudget(incident.investigationTeam) - PAGE_BOTTOM_SAFETY_PX);
  const supervisorNeed = measureNaturalHeight(supervisorText, textStyle);
  const safetyConsultantNeed = measureNaturalHeight(safetyConsultantText, textStyle);
  const [baseSupervisorHeight, baseSafetyConsultantHeight] = allocateFlexibleSections(
    [supervisorNeed, safetyConsultantNeed], notesBudgetPx, MIN_NOTE_BOX_HEIGHT_PX,
  );
  const leftoverAfterNotes = Math.max(0, notesBudgetPx - (baseSupervisorHeight + baseSafetyConsultantHeight));
  const maxTeamBonusTotal = (MAX_TEAM_ROW_HEIGHT_PX - MIN_TEAM_ROW_HEIGHT_PX) * 4;
  const teamBonusTotal = Math.min(leftoverAfterNotes, maxTeamBonusTotal);
  const teamRowHeight = MIN_TEAM_ROW_HEIGHT_PX + teamBonusTotal / 4;
  const remainingAfterTeam = leftoverAfterNotes - teamBonusTotal;
  const supervisorBoxHeight = baseSupervisorHeight + remainingAfterTeam / 2;
  const safetyConsultantBoxHeight = baseSafetyConsultantHeight + remainingAfterTeam / 2;
  const supervisorNotes = paginateBoxText(supervisorText, supervisorBoxHeight);
  const safetyConsultantNotes = paginateBoxText(safetyConsultantText, safetyConsultantBoxHeight);

  const overflowFields = [];
  if (description.overflow) overflowFields.push('Detailed Description of the Incident');
  statements.forEach((s, i) => { if (s.overflow) overflowFields.push(`Witness ${i + 1} Statement`); });
  if (supervisorNotes.overflow) overflowFields.push('Superintendent/Supervisor Notes & Summary');
  if (safetyConsultantNotes.overflow) overflowFields.push('Safety Consultant Notes & Summary');

  const descriptionChunks = description.chunks;
  const statementChunks = statements.map(s => s.chunks);
  const supervisorNotesChunks = supervisorNotes.chunks;
  const safetyConsultantNotesChunks = safetyConsultantNotes.chunks;

  const pages = [];
  pages.push({ key: 'p1', type: 'page1', props: { descriptionText: descriptionChunks[0], descriptionBoxHeightPx: page1Budget } });
  descriptionChunks.slice(1).forEach((chunk, i) => {
    pages.push({ key: `p1c${i}`, type: 'continuation', props: { sectionLabel: 'Detailed Description of the Incident', text: chunk } });
  });

  pages.push({ key: 'p2', type: 'page2', props: {} });

  pages.push({ key: 'p3', type: 'page3', props: { statementChunks, statementBoxHeights: [w1BoxHeight, w2BoxHeight] } });
  [0, 1].forEach(wIdx => {
    (statementChunks[wIdx] || []).slice(1).forEach((chunk, i) => {
      pages.push({ key: `p3c${wIdx}_${i}`, type: 'continuation', props: { sectionLabel: `Witness ${wIdx + 1} Statement`, text: chunk } });
    });
  });

  pages.push({ key: 'p4', type: 'page4', props: { statementChunks, witness3BoxHeightPx: w3BoxHeight } });
  (statementChunks[2] || []).slice(1).forEach((chunk, i) => {
    pages.push({ key: `p4c${i}`, type: 'continuation', props: { sectionLabel: 'Witness 3 Statement', text: chunk } });
  });

  pages.push({ key: 'p5', type: 'page5', props: {} });

  pages.push({
    key: 'p6',
    type: 'page6',
    props: {
      supervisorNotesChunk: supervisorNotesChunks[0],
      safetyConsultantNotesChunk: safetyConsultantNotesChunks[0],
      supervisorNotesBoxHeight: supervisorBoxHeight,
      safetyConsultantNotesBoxHeight: safetyConsultantBoxHeight,
      teamRowHeightPx: teamRowHeight,
    },
  });
  supervisorNotesChunks.slice(1).forEach((chunk, i) => {
    pages.push({ key: `p6sc${i}`, type: 'continuation', props: { sectionLabel: 'Superintendent/Supervisor Notes & Summary', text: chunk } });
  });
  safetyConsultantNotesChunks.slice(1).forEach((chunk, i) => {
    pages.push({ key: `p6cc${i}`, type: 'continuation', props: { sectionLabel: 'Safety Consultant Notes & Summary', text: chunk } });
  });

  // INCIDENT PHOTO APPENDIX -- always appended LAST, after every base page
  // and every text-overflow continuation page above, and only when the
  // report actually has photos (see the "Empty state" rule: zero photos
  // must never add a page or change the existing six-page count). Two
  // photos per page (see PHOTO_FRAME_HEIGHT_PX in incidentPdfLayout.js for
  // why a fixed-per-page count is safe here, unlike the real-measurement
  // pagination the base pages use above).
  const photos = incident.photos || [];
  for (let i = 0; i < photos.length; i += 2) {
    const chunk = photos.slice(i, i + 2);
    pages.push({
      key: `photoAppendix${i / 2}`,
      type: 'photoAppendix',
      headerLabel: 'INCIDENT PHOTO APPENDIX',
      props: { photos: chunk },
    });
  }

  return { pages, overflowFields };
}

/* Export preflight check: which (if any) long-text fields could not be
   confirmed to fit within their base box + continuation pages. Call this
   before generateIncidentPdf() and abort with a clear message if it
   returns anything -- never generate (or silently accept) a PDF that may
   have clipped content. */
export function getIncidentPdfOverflowFields(incident) {
  return buildIncidentPagePlan(incident).overflowFields;
}

const PAGE_COMPONENTS = {
  page1: Page1Content,
  page2: Page2Content,
  page3: Page3Content,
  page4: Page4Content,
  page5: Page5Content,
  page6: Page6Content,
  photoAppendix: PhotoAppendixContent,
};

/* v0.1.6 -- html2canvas (the library that actually rasterizes every
   exported PDF page -- see generateIncidentPdf() below) does not honor
   vertical-align OR flex centering for text inside a table cell once that
   cell's rendered height exceeds its own content's natural height. This
   was proven by comparing the REAL html2canvas raster pixel-for-pixel
   before/after trying both techniques (see tools/testing/output/v016-audit/
   from the v0.1.6 audit) -- the live DOM measures as perfectly centered
   either way, but the actual exported page still shows text pinned toward
   the top. What DOES render correctly in the raster, confirmed the same
   way: padding. So every compact cell's content (wrapped in a shared
   .incCellContent span -- see IncidentPdf.jsx) gets its vertical centering
   computed here, from real measured slack, and applied as literal
   padding-top/padding-bottom -- the same "measure the real DOM, don't
   guess" approach this module already uses for page-budget allocation
   (measurePage1Budget etc. in incidentPdfMeasure.js) and for Investigation
   Team's row height (teamRowHeightPx), just applied one level deeper.
   Runs after every render (useLayoutEffect, before paint) so there's no
   visible flash -- cost is a handful of already-cached layout reads per
   cell, no more expensive than the other measurement passes in this file.

   Three separate passes over every wrapper, deliberately not combined into
   one loop: a table ROW's rendered height is the max of every cell sharing
   that row, so resetting+measuring+applying one cell at a time lets an
   still-padded sibling (not yet reached in the loop) keep the row taller
   than its true natural height -- inflating that cell's measured "extra"
   slack, which inflates ITS applied padding, which keeps the row inflated
   for the NEXT cell too. That compounds into runaway growth across a row
   (caught during the v0.1.6 visual audit: page 5's first cause-table row
   grew to several times its correct height). Resetting every wrapper
   first, then measuring every wrapper against that fully-reset layout,
   then applying every computed padding, means every measurement reflects
   the table's true natural (unpadded) geometry, not a partially-updated
   in-between state.

   v0.1.7 tried layering an intentional design bias into this same padding
   split (more padding-top, less padding-bottom) so the math-centered result
   would read as shifted upward. Removed in v0.1.8: biasing padding is
   inherently clamped to each cell's own real slack, so a tight cell (most
   compact cells with short single-line content, which is most of them)
   had little or no room to move and the requested shift wasn't visible
   where it mattered most. This function now does ONLY true mathematical
   centering again -- the intentional visual-design shift is a separate,
   fixed, slack-independent CSS offset on .incCellContent itself (see
   incident.css) applied on top of whatever centered position this
   function establishes. Two separate concepts, two separate mechanisms:
   this establishes the stable baseline; the CSS offset is the deliberate
   bias on top of it. */
function centerCompactCellContent(renderedPages) {
  const wraps = [];
  renderedPages.forEach(({ el }) => {
    if (!el) return;
    el.querySelectorAll('.incCellContent').forEach((wrap) => wraps.push(wrap));
  });

  wraps.forEach((wrap) => {
    wrap.style.paddingTop = '';
    wrap.style.paddingBottom = '';
  });

  const adjustments = wraps.map((wrap) => {
    const cell = wrap.parentElement;
    if (!cell) return null;
    const cellStyle = getComputedStyle(cell);
    const availableH = cell.clientHeight - parseFloat(cellStyle.paddingTop) - parseFloat(cellStyle.paddingBottom);
    const contentH = wrap.scrollHeight;
    // wrap.scrollHeight is always an integer (browser-rounded), while
    // availableH can be fractional (real cell heights throughout this
    // module are sub-pixel, e.g. "42.66px") -- splitting the raw
    // difference in half and applying it as padding can therefore push the
    // wrapper's true rendered height a hair past availableH once the
    // browser re-lays it out, even though the arithmetic looks exact on
    // paper. That's harmless on its own (table cells don't clip), but it
    // was measured to compound across many cells into a real few-px page
    // overflow on witness-heavy pages (see the v0.1.6 audit). Floor BOTH
    // halves (never round up) and reserve an extra 1px buffer so applied
    // padding always totals strictly less than the measured slack --
    // trades an imperceptible sub-pixel asymmetry for a hard guarantee
    // against overflow.
    const extra = availableH - contentH - 1;
    if (extra <= 1) return null;
    const half = Math.floor(extra / 2);
    return { wrap, top: half, bottom: half };
  });

  adjustments.forEach((adj) => {
    if (!adj) return;
    adj.wrap.style.paddingTop = `${adj.top}px`;
    adj.wrap.style.paddingBottom = `${adj.bottom}px`;
  });
}

export function IncidentPdfExportRoot({ incident, pageRefsRef }) {
  const elRefs = useRef({});
  const photoUrls = useIncidentPhotoUrls(incident.photos);

  const { pages } = useMemo(() => buildIncidentPagePlan(incident), [
    incident.detailedIncidentDescription,
    incident.witnesses,
    incident.immediateActionsTaken,
    incident.correctivePreventiveActions,
    incident.safetyConsultantNotes,
    incident.workplaceLocation,
    incident.incidentDate,
    incident.incidentTime,
    incident.writtenReportDateTime,
    incident.reportedToSupervisorDateTime,
    incident.investigatorName,
    incident.investigatorTitle,
    incident.investigatorPhone,
    incident.investigatorEmail,
    incident.incidentSpecificLocation,
    incident.injuryOccurred,
    incident.injuredPartyName,
    incident.injuredPartyTitle,
    incident.injuredPartyYearsWithCompany,
    incident.injuredPartyCurrentTrade,
    incident.injuredPartyPhone,
    incident.injuredPartyEmail,
    incident.injuryNature,
    incident.injuryNatureOther,
    incident.bodyPartsAffectedText,
    incident.treatmentLevel,
    incident.treatingPhysicianOrClinic,
    incident.injuryRemarks,
    incident.bodyDiagramMarks,
    incident.propertyDamageOccurred,
    incident.propertyOrMaterialDamaged,
    incident.natureOfDamage,
    incident.objectMachineToolOrSubstance,
    incident.approximateDamageCost,
    incident.selectedCauses,
    incident.primaryCause,
    incident.unsafeActsOther,
    incident.unsafeConditionsOther,
    incident.managementDeficienciesOther,
    incident.investigationTeam,
    incident.photos,
  ]);
  const totalPages = pages.length;

  useLayoutEffect(() => {
    pageRefsRef.current = pages.map(p => ({ type: p.type, el: elRefs.current[p.key] }));
    centerCompactCellContent(pageRefsRef.current);
  });

  return (
    <div className="incidentPdfExportRoot" aria-hidden="true">
      {pages.map((p, i) => {
        const pageNumber = i + 1;
        const setRef = el => { elRefs.current[p.key] = el; };
        if (p.type === 'continuation') {
          return (
            <ContinuationPage
              key={p.key}
              incident={incident}
              pageNumber={pageNumber}
              totalPages={totalPages}
              pageRef={setRef}
              {...p.props}
            />
          );
        }
        const Content = PAGE_COMPONENTS[p.type];
        return (
          <IncidentPageShell key={p.key} pageRef={setRef} pageNumber={pageNumber} totalPages={totalPages} headerLabel={p.headerLabel}>
            <Content incident={incident} photoUrls={photoUrls} {...p.props} />
          </IncidentPageShell>
        );
      })}
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

/* Incident Photo Appendix images load asynchronously (blob -> IndexedDB
   read -> object URL, see useIncidentPhotoUrls.js) -- by the time a user
   reaches Review & Export this has almost always already settled (the
   always-mounted export root has been rendering in the background since
   the photo was added), but nothing guarantees it (e.g. a page reload
   landing straight on Review). Waiting for every real <img> in a page to
   finish loading (or fail) before handing that page to html2canvas is the
   same "measure/verify the real DOM, don't assume" philosophy the rest of
   this module already uses -- it also cheaply no-ops for pages whose
   images (signatures, the body diagram, the logo) are already loaded. */
function waitForImages(el) {
  const imgs = Array.from(el.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true }); // never block export on one broken image
    });
  }));
}

/* Deterministic client-side PDF assembly -- same approach as the JSA's
   generateJsaPdf: capture each already-rendered logical page with
   html2canvas, one at a time, and assemble with pdf-lib. No browser print
   pagination involved. */
export async function generateIncidentPdf(pageRefsRef, onProgress) {
  const pages = pageRefsRef.current;
  if (!pages.length) throw new Error('No pages to export -- the document plan is empty.');

  /* Fetched on demand, not at the top of the file -- see
     ../documents/pdfLibs.js. */
  const { html2canvas, PDFDocument } = await loadPdfLibs();

  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* non-fatal */ }
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const isTouchPrimary = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches;
  const scale = isTouchPrimary ? 2 : 2.5;

  const pdfDoc = await PDFDocument.create();
  const PT_PER_IN = 72;
  const LETTER_WIDTH_PT = 8.5 * PT_PER_IN;
  const LETTER_HEIGHT_PT = 11 * PT_PER_IN;

  for (let i = 0; i < pages.length; i += 1) {
    const { type, el } = pages[i];
    onProgress?.(i + 1, pages.length);
    if (!el) throw new Error(`Page ${i + 1} of ${pages.length} (${type}) did not render -- export aborted.`);

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error(`Page ${i + 1} of ${pages.length} (${type}) has no measurable size -- export aborted.`);
    }

    await waitForImages(el);

    let canvas;
    try {
      canvas = await html2canvas(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
    } catch (err) {
      throw new Error(`Failed to render page ${i + 1} of ${pages.length} (${type}): ${err?.message || err}`);
    }
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error(`Page ${i + 1} of ${pages.length} (${type}) captured empty -- export aborted.`);
    }

    const pngBytes = dataUrlToUint8Array(canvas.toDataURL('image/png'));
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const pdfPage = pdfDoc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: LETTER_WIDTH_PT, height: LETTER_HEIGHT_PT });

    canvas.width = 0;
    canvas.height = 0;
    canvas = null;
  }

  const pdfBytes = await pdfDoc.save();
  const verifyDoc = await PDFDocument.load(pdfBytes);
  const pageCount = verifyDoc.getPageCount();
  if (pageCount !== pages.length) {
    throw new Error(`Generated PDF has ${pageCount} pages but the plan has ${pages.length} -- export aborted.`);
  }

  return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), pageCount };
}

/* Combines the printed-content fingerprint with whether the report would
   currently print as a final (no watermark) or draft (watermarked) document.
   Deliberately does NOT use the raw status string here: "ready" and
   "completed" print identically (isIncidentPrintFinal is true for both), so
   using status directly would falsely mark an already-generated final PDF
   as stale the instant exportIncidentPdf() flips ready -> completed after a
   successful export, even though nothing the PDF actually shows changed.
   Mirrors the JSA's fingerprintPaginationInput, which excludes the same
   category of non-printed fields for the same reason. */
export function incidentPdfFingerprint(incident) {
  return JSON.stringify({ printed: printedIncidentFingerprint(incident), final: isIncidentPrintFinal(incident) });
}

export function buildIncidentExportName(incident) {
  const draft = !isIncidentPrintFinal(incident);
  const raw = [incident.workplaceLocation || 'Shackelford', 'IncidentReport', incident.incidentDate || ''].filter(Boolean).join('_');
  const clean = raw.replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return draft ? `${clean}_DRAFT` : clean;
}
