/* Real-DOM measurement of how much vertical space each incident PDF base
   page (1, 3, 4, 6) actually has left for its flexible form area(s), once
   that page's fixed-but-data-dependent chrome above/around it (tables,
   gray bars, help text, signature rows, the investigation-team table) is
   accounted for.

   Same philosophy as textFit.js's fitTextToHeight: rather than compute this
   from font-metric arithmetic or a fixed guess (fragile -- this app has
   already been burned twice by that: v0.1's estimate-based JSA pagination,
   and v0.1.1's fixed per-field PDF box heights that either wasted most of a
   page or forced an unnecessary continuation page), build a plain-DOM
   skeleton using the exact same incident.css classes -- and, where the
   chrome's own height depends on the incident's real data (e.g. a long
   Workplace Location or witness email wrapping to two lines), the exact
   same real values -- as the real page, mount it off-screen, and read real
   getBoundingClientRect() values. If a future change to incident.css or to
   IncidentPdf.jsx's markup alters any of this, the measurement picks it up
   automatically instead of silently going stale.

   Shared building blocks (buildInfoTableSkeleton, buildTextBlockSkeleton,
   buildSignatureTableSkeleton, appendWitnessChrome) are reused across every
   page's measurement function below instead of each page hand-rolling its
   own DOM -- see the v0.1.2 full-page-utilization pass. */

import { label, value, fmtDate, fmtTime, fmtDateTime, page2InjuredPartyRows } from './IncidentPdf';
import { SUPERVISOR_NOTES_HELP } from './incidentPdfLayout';

let measureHost = null;

function getMeasureHost() {
  if (measureHost && document.body.contains(measureHost)) return measureHost;
  measureHost = document.createElement('div');
  measureHost.setAttribute('aria-hidden', 'true');
  measureHost.style.position = 'fixed';
  measureHost.style.top = '0';
  measureHost.style.left = '-99999px';
  measureHost.style.visibility = 'hidden';
  measureHost.style.pointerEvents = 'none';
  document.body.appendChild(measureHost);
  return measureHost;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildHeaderSkeleton() {
  const header = el('header', 'incidentHeader');
  const bar = el('div', 'incidentHeaderBar');
  bar.appendChild(el('div', 'incidentHeaderLogo'));
  const titles = el('div', 'incidentHeaderTitles');
  titles.appendChild(el('h1', null, 'INCIDENT REPORTING AND INVESTIGATION FORM'));
  bar.appendChild(titles);
  bar.appendChild(el('div', 'incidentHeaderPageNum', 'Page 1 of 6'));
  header.appendChild(bar);
  header.appendChild(el('div', 'incidentRedRule'));
  return header;
}

function mountPageSkeleton() {
  const host = getMeasureHost();
  const page = el('div', 'incidentPage');
  page.appendChild(buildHeaderSkeleton());
  const body = el('div', 'incidentPageBody');
  page.appendChild(body);
  host.appendChild(page);
  return { host, page, body };
}

/* The total real rendered height of a base page's body region (everything
   below the header, above the bottom page padding) -- the true available
   space for a page's content, not a guess derived from page/margin/header
   constants. */
export function measureIncidentPageBodyHeight() {
  const { host, page, body } = mountPageSkeleton();
  try {
    return body.getBoundingClientRect().height;
  } finally {
    host.removeChild(page);
  }
}

/* Mounts a real `.incidentPage` (fixed 8.5in x 11in, exactly like the
   printed page) with a header and a body populated by `buildChrome`, then
   measures:
     - the body's own real rendered height (flex:1 1 auto fills whatever is
       left of the fixed-height page after the header -- this is the TRUE
       available space, not a guess)
     - how much of that space the chrome (everything buildChrome appended)
       actually uses, once the "flexible" box(es) it returns are excluded at
       their natural (empty) height
   and returns the leftover budget those flexible boxes can share. Generic
   across every base page -- see measurePage1Budget/measurePage3Budget/
   measurePage4Budget/measurePage6NotesBudget below for how each page uses
   it. */
export function measureFlexBudget(buildChrome) {
  const { host, page, body } = mountPageSkeleton();
  let budget = 0;
  try {
    const boxes = buildChrome(body);
    const bodyRect = body.getBoundingClientRect();
    const lastChild = body.lastElementChild;
    const usedHeight = lastChild ? lastChild.getBoundingClientRect().bottom - bodyRect.top : 0;
    const boxesHeight = boxes.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
    const chromeOnly = usedHeight - boxesHeight;
    budget = bodyRect.height - chromeOnly;
  } finally {
    host.removeChild(page);
  }
  return budget;
}

/* ── Shared chrome builders ──
   Mirror the exact classNames/structure IncidentPdf.jsx renders, reusing
   its own label()/value() row-cell helpers and date formatters so a
   skeleton table is built identically to (and wraps text identically to)
   the real one. */

function buildInfoTableSkeleton(rows) {
  const table = el('table', 'incInfoTable');
  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr');
    row.forEach((cell) => {
      const node = el(cell.isLabel ? 'th' : 'td', null, cell.text);
      if (cell.width) node.style.width = cell.width;
      if (cell.colSpan) node.colSpan = cell.colSpan;
      tr.appendChild(node);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* Mirrors TextBlock's markup. Returns the flexible `box` element (appended
   empty -- i.e. at its natural/minimum size) so the caller can pass it to
   measureFlexBudget's `boxes` list. */
function buildTextBlockSkeleton({ title, help }) {
  const wrap = el('div', 'incTextBlockWrap');
  if (title) wrap.appendChild(el('div', 'incTextBlockTitle', title));
  if (help) wrap.appendChild(el('div', 'incTextBlockHelp', help));
  const box = el('div', 'incTextBlock', '');
  wrap.appendChild(box);
  return { wrap, box };
}

/* Mirrors WitnessBlock's incSignatureTable row. */
function buildSignatureTableSkeleton() {
  const table = el('table', 'incInfoTable incSignatureTable');
  const tbody = el('tbody');
  const tr = el('tr');
  const th1 = el('th', null, 'Signature');
  th1.style.width = '18%';
  const td1 = el('td', 'incSignatureCell', '');
  const th2 = el('th', null, 'Date');
  th2.style.width = '14%';
  const td2 = el('td', null, '');
  tr.append(th1, td1, th2, td2);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  return table;
}

/* Mirrors WitnessBlock's full markup (gray bar, contact table, "Statement"
   title, signature row) EXCEPT the statement box itself is left to the
   caller -- appended here as an empty flexible box and returned so callers
   on pages 3 and 4 can share it across measureFlexBudget's boxes list. */
function appendWitnessChrome(body, index, witness) {
  const w = witness || {};
  const na = (v) => (witness ? (v || 'N/A') : 'N/A');
  body.appendChild(el('div', 'incGrayBar', `WITNESS ${index}`));
  body.appendChild(buildInfoTableSkeleton([
    [label('Name', '22%'), value(na(w.name)), label('Company', '22%'), value(na(w.company))],
    [label('Supervisor', '22%'), value(na(w.supervisor)), label('Phone', '22%'), value(na(w.phone))],
    [label('Email', '22%'), value(na(w.email)), label('Date', '22%'), value(witness && w.signatureDate ? fmtDate(w.signatureDate) : 'N/A')],
  ]));
  const { wrap, box } = buildTextBlockSkeleton({ title: 'Statement' });
  body.appendChild(wrap);
  body.appendChild(buildSignatureTableSkeleton());
  return box;
}

/* ── PAGE 1 ──
   Returns how much real vertical space is left for the Detailed Description
   box once the (data-dependent, may wrap) top info table, supervisor
   contact table, and incident-location table are rendered with the
   incident's real values. */
export function measurePage1Budget(incident) {
  return measureFlexBudget((body) => {
    body.appendChild(buildInfoTableSkeleton([
      [label('Workplace Location', '25%'), value(incident.workplaceLocation, 3)],
      [label('Date of Incident', '25%'), value(fmtDate(incident.incidentDate)), label('Time of Incident', '25%'), value(fmtTime(incident.incidentTime))],
      [label('Date/Time of Written Report', '25%'), value(fmtDateTime(incident.writtenReportDateTime), 3)],
      [label('Date/Time Reported to Supervisor', '25%'), value(fmtDateTime(incident.reportedToSupervisorDateTime), 3)],
    ]));
    body.appendChild(el('div', 'incGrayBar', 'SUPERINTENDENT/SUPERVISOR CONTACT INFORMATION'));
    body.appendChild(buildInfoTableSkeleton([
      [label('Reporting Supervisor/Investigator Name', '32%'), value(incident.investigatorName)],
      [label('Title/Position', '32%'), value(incident.investigatorTitle)],
      [label('Contact Number', '32%'), value(incident.investigatorPhone)],
      [label('Email Address', '32%'), value(incident.investigatorEmail)],
    ]));
    body.appendChild(buildInfoTableSkeleton([
      [label('Where the Incident Occurred (specify)', '32%'), value(incident.incidentSpecificLocation)],
    ]));
    const { wrap, box } = buildTextBlockSkeleton({ title: 'DETAILED DESCRIPTION OF THE INCIDENT' });
    body.appendChild(wrap);
    return [box];
  });
}

/* ── PAGE 2 ──
   Returns how much real vertical space the Remarks/Comments box and the
   body-diagram image share, once the Injury line, the injured-party table
   (real values -- a long name or multi-injury list wraps) and both section
   titles are rendered. The diagram section is measured at its natural
   (title-only) height: on the real page it is flex:1 and takes whatever the
   remarks box leaves, which is exactly what a long remark used to squeeze
   to nothing. */
export function measurePage2Budget(incident) {
  return measureFlexBudget((body) => {
    const val = incident.injuryOccurred === 'yes' ? 'YES' : incident.injuryOccurred === 'no' ? 'NO' : '\u2014';
    const note = incident.injuryOccurred === 'yes' ? ' (see details below)' : '';
    body.appendChild(el('div', 'incYesNoLine', `INJURY: ${val}${note}`));
    body.appendChild(el('div', 'incGrayBar', 'INJURED PARTY'));
    body.appendChild(buildInfoTableSkeleton(page2InjuredPartyRows(incident)));
    const { wrap, box } = buildTextBlockSkeleton({ title: 'Remarks/Comments' });
    body.appendChild(wrap);
    const diagram = el('div', 'incBodyDiagramSection');
    diagram.style.flex = 'none';
    diagram.appendChild(el('div', 'incTextBlockTitle', 'PART OF BODY AFFECTED (MARK ALL AREAS THAT APPLY)'));
    diagram.appendChild(el('div', 'incidentBodyDiagramPrint'));
    body.appendChild(diagram);
    return [box];
  });
}

/* ── PAGE 3 ──
   Returns how much real vertical space is left for Witness 1 and Witness
   2's statement boxes COMBINED, once both witnesses' real contact tables
   and signature rows are rendered. Caller (buildIncidentPagePlan) splits
   this between the two based on actual content need. */
export function measurePage3Budget(incident) {
  const witnesses = incident.witnesses || [];
  return measureFlexBudget((body) => {
    body.appendChild(el('div', 'incGrayBar', 'WITNESS AND/OR WITNESS STATEMENT'));
    const box1 = appendWitnessChrome(body, 1, witnesses[0]);
    const box2 = appendWitnessChrome(body, 2, witnesses[1]);
    return [box1, box2];
  });
}

/* ── PAGE 4 ──
   Returns how much real vertical space is left for Witness 3's statement
   box once its own contact/signature chrome AND the (real, data-dependent)
   property-damage table are rendered. The property-damage section is
   treated as fixed content here -- it is never a flexible box. */
export function measurePage4Budget(incident) {
  const witnesses = incident.witnesses || [];
  const damaged = incident.propertyDamageOccurred === 'yes';
  const na = (v) => (damaged ? (v || 'N/A') : 'N/A');
  return measureFlexBudget((body) => {
    const box3 = appendWitnessChrome(body, 3, witnesses[2]);
    const val = incident.propertyDamageOccurred === 'yes' ? 'YES' : incident.propertyDamageOccurred === 'no' ? 'NO' : '\u2014';
    const note = incident.propertyDamageOccurred === 'yes' ? ' (see details below)' : '';
    body.appendChild(el('div', 'incYesNoLine', `PROPERTY DAMAGE: ${val}${note}`));
    body.appendChild(buildInfoTableSkeleton([
      [label('List Property/Material Damaged', '38%'), value(na(incident.propertyOrMaterialDamaged))],
      [label('Nature of Damage', '38%'), value(na(incident.natureOfDamage))],
      [label('Object(s)/Machine(s)/Tool(s)/Substance(s) Inflicting Damage', '38%'), value(na(incident.objectMachineToolOrSubstance))],
      [label('Approximate Cost of Damage', '38%'), value(na(incident.approximateDamageCost))],
    ]));
    return [box3];
  });
}

function buildTeamTableSkeleton(investigationTeam) {
  const table = el('table', 'incInfoTable incTeamTable');
  const thead = el('thead');
  const headRow = el('tr');
  ['Name', 'Title', 'Signature', 'Date'].forEach((h) => headRow.appendChild(el('th', null, h)));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  const team = investigationTeam || [];
  for (let i = 0; i < 4; i += 1) {
    const m = team[i];
    const tr = el('tr');
    tr.appendChild(el('td', null, m?.name || ''));
    tr.appendChild(el('td', null, m?.title || ''));
    // A signature is a fixed-height <img> (.incSignatureImage) -- for row
    // *height* purposes an empty cell vs. an image cell are equivalent once
    // the row's own height (var(--incTeamRowHeight), unset here so it uses
    // the CSS default) is >= the image's height, which it is, so no need to
    // fabricate an actual image here. Row height itself is measured at the
    // CSS default (MIN_TEAM_ROW_HEIGHT_PX) -- any growth beyond that is
    // decided from this page's leftover budget in buildIncidentPagePlan(),
    // not measured directly.
    tr.appendChild(el('td', null, ''));
    tr.appendChild(el('td', null, m?.date || ''));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/* Returns the total px height page 6's two notes boxes can share, given the
   real (not placeholder) investigation-team data -- a long member name/title
   that wraps to two lines legitimately shrinks the notes budget, same as it
   would on the real printed page. The investigation-team table itself is
   measured at its CSS-default (minimum) row height here; buildIncidentPagePlan()
   separately decides how much of the leftover (after the notes get what they
   need) to give back to the table as row growth -- see MAX_TEAM_ROW_HEIGHT_PX. */
export function measurePage6NotesBudget(investigationTeam) {
  return measureFlexBudget((body) => {
    body.appendChild(el('div', 'incGrayBar', 'SUPERINTENDENT/SUPERVISOR NOTES & SUMMARY'));
    const wrap1 = el('div', 'incTextBlockWrap');
    wrap1.appendChild(el('div', 'incTextBlockHelp', SUPERVISOR_NOTES_HELP));
    const box1 = el('div', 'incTextBlock', '');
    wrap1.appendChild(box1);
    body.appendChild(wrap1);

    body.appendChild(el('div', 'incGrayBar', 'SAFETY CONSULTANT NOTES & SUMMARY'));
    const wrap2 = el('div', 'incTextBlockWrap');
    const box2 = el('div', 'incTextBlock', '');
    wrap2.appendChild(box2);
    body.appendChild(wrap2);

    body.appendChild(el('div', 'incGrayBar', 'INVESTIGATION TEAM'));
    body.appendChild(buildTeamTableSkeleton(investigationTeam));

    return [box1, box2];
  });
}
