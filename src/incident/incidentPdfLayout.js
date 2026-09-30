/* Shared pixel/point metrics for the incident PDF page components and their
   text-fit measurement (textFit.js). Kept in one JS module (rather than
   only in CSS) because generateIncidentPdf() needs the exact same
   width/font metrics JS-side to measure real text before deciding what
   goes on a base page vs. a continuation page. The matching CSS rules in
   incident.css use the literal px/pt values below -- if you change a
   number here, update the matching rule in incident.css (search for the
   same class name) so measurement and rendering never drift apart.

   96 CSS px per inch, 1pt = 1.3333px (browser standard), used throughout
   since generation renders at normal DOM scale -- html2canvas's `scale`
   option magnifies the final raster only, it never changes CSS layout. */

export const PAGE_WIDTH_IN = 8.5;
export const PAGE_HEIGHT_IN = 11;
export const PAGE_MARGIN_IN = 0.3;
export const PX_PER_IN = 96;

export const PAGE_WIDTH_PX = PAGE_WIDTH_IN * PX_PER_IN;
export const PAGE_HEIGHT_PX = PAGE_HEIGHT_IN * PX_PER_IN;
export const PAGE_MARGIN_PX = PAGE_MARGIN_IN * PX_PER_IN;
export const CONTENT_WIDTH_PX = PAGE_WIDTH_PX - PAGE_MARGIN_PX * 2;

export const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const FONT_10PT_PX = 10 * (96 / 72); // 13.33px
export const FONT_9PT_PX = 9 * (96 / 72); // 12px

// Long free-text block metrics (description, witness statements, notes) --
// must exactly mirror .incTextBlock in incident.css (border/padding/
// line-height/font-size). `.incTextBlock` has no explicit width of its own:
// it stretches (flex column, align-items: stretch by default) to fill its
// `.incTextBlockWrap` parent, which itself stretches to fill
// `.incidentPageBody`'s content width -- i.e. the real rendered box's outer
// (border-box) width is exactly CONTENT_WIDTH_PX. textBlockMeasureStyle()
// reproduces that same border-box width AND a matching 1px border (rather
// than the pre-v0.1.3 approach of fudging the width a few px narrower to
// approximate the missing border) so the detached measurement div in
// textFit.js wraps text at the identical column width the real box will --
// no drift, no guessing. See incident.css's .incTextBlock comment for the
// padding/line-height rationale (top-aligned narrative text, comfortable
// padding, ~1.35x line-height).
export const TEXT_BLOCK_WIDTH_PX = CONTENT_WIDTH_PX;
export const TEXT_BLOCK_FONT_PX = FONT_10PT_PX;
export const TEXT_BLOCK_LINE_HEIGHT_PX = 18;
export const TEXT_BLOCK_BORDER_PX = 1;
export const TEXT_BLOCK_PADDING_TOP_PX = 9;
export const TEXT_BLOCK_PADDING_SIDE_PX = 9;
export const TEXT_BLOCK_PADDING_BOTTOM_PX = 8;

export function textBlockMeasureStyle() {
  return {
    width: `${TEXT_BLOCK_WIDTH_PX}px`,
    fontSize: `${TEXT_BLOCK_FONT_PX}px`,
    lineHeight: `${TEXT_BLOCK_LINE_HEIGHT_PX}px`,
    fontFamily: FONT_FAMILY,
    border: `${TEXT_BLOCK_BORDER_PX}px solid transparent`,
    padding: `${TEXT_BLOCK_PADDING_TOP_PX}px ${TEXT_BLOCK_PADDING_SIDE_PX}px ${TEXT_BLOCK_PADDING_BOTTOM_PX}px`,
  };
}

// None of the base-page flexible boxes below (description, witness
// statements, notes) use a fixed height anymore -- see incidentPdfMeasure.js.
// A fixed box (this module's own now-removed v0.1.1 DESCRIPTION_FIRST_HEIGHT_PX
// / STATEMENT_FIRST_HEIGHT_PX / NOTES_FIRST_HEIGHT_PX) always left whatever
// gap existed between that guess and the page's true remaining space unused
// -- sometimes a lot of it (v0.1.2's "pages end halfway down the sheet"
// report), sometimes too little (forcing an unnecessary continuation page,
// v0.1.1's page-7 bug). Instead, buildIncidentPagePlan() measures each base
// page's REAL remaining space with the real (data-dependent) content above
// it already rendered (measurePage1Budget/measurePage3Budget/
// measurePage4Budget/measurePage6NotesBudget in incidentPdfMeasure.js) and
// allocates it to that page's flexible box(es) -- see
// allocateFlexibleSections / allocateAndFillFlexibleSections in
// incidentPdfGenerate.jsx. These constants are now only the FLOOR each
// flexible box is guaranteed even if a page's real content leaves very
// little room (e.g. an unusually long workplace-location value) -- large
// enough to stay usable, small enough to never be the reason a short field
// looks artificially padded.
export const MIN_DESCRIPTION_HEIGHT_PX = 300;
export const MIN_STATEMENT_HEIGHT_PX = 130;
export const MIN_NOTE_BOX_HEIGHT_PX = 40;

// Page 2's body diagram takes whatever the Remarks/Comments box leaves (it
// is flex:1 in incident.css). A long remark used to shrink it to a sliver --
// or push it off the overflow:hidden page -- with no warning. A remark that
// would leave the diagram shorter than this blocks export instead (see
// buildIncidentPagePlan). ~3.5in: checked on real exports -- at this size
// all three figures and the marks still read clearly; by ~300px they are
// getting small. With the usual one-line injured-party rows that allows
// about 14 lines (~1,700 characters) of remarks; the full 573px diagram is
// what a 1-2 line remark gets.
export const MIN_BODY_DIAGRAM_HEIGHT_PX = 340;

// Page 6's investigation-team rows: MIN matches the table's own long-standing
// CSS default (enough for a normal signature image), MAX caps how much of
// page 6's genuine leftover space (after notes get what they actually need)
// can go into taller rows -- generous enough to visibly use the space
// (v0.1.2's "ends halfway down the sheet" report) without rows growing
// "absurdly tall" for a 4-row name/title/signature/date table. Lowered from
// 90 to 68 in the v0.1.4 polish pass (rows at 90px read as artificially
// stretched for a 4-row table); any leftover budget above the new cap flows
// back into the Supervisor/Safety Consultant notes boxes instead (see
// buildIncidentPagePlan in incidentPdfGenerate.jsx -- this rebalancing is
// automatic, not a separate change).
export const MIN_TEAM_ROW_HEIGHT_PX = 40;
export const MAX_TEAM_ROW_HEIGHT_PX = 68;

// Small buffer subtracted from every measured budget before it's handed to a
// flexible box. The measurement skeleton (incidentPdfMeasure.js) and the
// real rendered page use the same CSS classes/text, so they should measure
// identically, but this protects against a 1-2px browser rounding drift
// between the two passes turning into a clipped page (.incidentPage has
// `overflow: hidden`) instead of just an imperceptibly smaller box.
export const PAGE_BOTTOM_SAFETY_PX = 3;

// Continuation pages have a much larger, mostly-empty page to work with.
export const CONTINUATION_BODY_HEIGHT_PX = 760;

// Shared with Page6Content (IncidentPdf.jsx) and measurePage6NotesBudget
// (incidentPdfMeasure.js) so both always render/measure the exact same
// help text -- if this ever changes, both the printed page and the
// available-space measurement stay in sync automatically.
export const SUPERVISOR_NOTES_HELP = 'List immediate actions to be taken & what should be done to help prevent a recurrence of this type of incident.';

// ── Incident Photo Appendix ──
// Two photo blocks stacked vertically per page (not side-by-side): a
// side-by-side layout would squeeze a landscape photo's width in half,
// while stacking lets every photo -- portrait or landscape -- use the
// page's full content width and just varies how much of the fixed frame
// height it fills (object-fit: contain, see PhotoAppendixContent in
// IncidentPdf.jsx). A fixed frame height (rather than measuring real
// per-photo content like the base pages do) is deliberately simple here:
// the caption input is capped at 220 characters (see
// incidentCopy.js/IncidentPhotos.jsx), which at this column width never
// wraps past a few lines, so two fixed-height blocks reliably fit one
// page with room to spare -- verified against PAGE_HEIGHT_PX below. If a
// future change ever removes that caption cap, this budget should go back
// to real measurement (like textFit.js) instead of staying a fixed guess.
export const PHOTO_FRAME_HEIGHT_PX = 330;
export const PHOTO_BLOCK_GAP_PX = 14;

