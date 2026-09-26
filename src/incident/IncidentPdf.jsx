import { CAUSE_CATEGORIES, causeKey } from './incidentModel';
import { BODY_DIAGRAM_SRC, BODY_DIAGRAM_ASPECT } from './BodyDiagram';
import { SUPERVISOR_NOTES_HELP, MIN_NOTE_BOX_HEIGHT_PX, MIN_TEAM_ROW_HEIGHT_PX, PHOTO_FRAME_HEIGHT_PX, PHOTO_BLOCK_GAP_PX } from './incidentPdfLayout';

/* Print/PDF rendering for the Incident Report. Mirrors the reference
   document ("SCH Blank incident report (1).docx") section-for-section:
   same six pages, same section order, same field wording. Continuation
   pages are appended for any of the four long free-text fields whose
   content doesn't fit its base-page box (see textFit.js /
   incidentPdfGenerate.js for how chunks are computed) -- nothing here ever
   truncates text itself, it only renders whatever chunk it's given. */

const SHACKELFORD_LOGO = `${import.meta.env.BASE_URL}icons/shackelford-logo.webp`;
const FORM_TITLE = 'INCIDENT REPORTING AND INVESTIGATION FORM';

export function fmtDate(v) {
  if (!v) return '';
  // Accepts YYYY-MM-DD (native date input) -- render as MM/DD/YYYY to match
  // the reference document's own "(MM/DD/YY)" convention.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export function fmtDateTime(v) {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return v;
  const [, y, mo, d, h, mi] = m;
  const hour = Number(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = ((hour + 11) % 12) + 1;
  return `${mo}/${d}/${y} ${h12}:${mi} ${ampm}`;
}

export function fmtTime(v) {
  if (!v) return '';
  const m = /^(\d{2}):(\d{2})/.exec(v);
  if (!m) return v;
  const hour = Number(m[1]);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${m[2]} ${ampm}`;
}

/* No DRAFT watermark, matching the other five documents (Fonzo, 2026-09-09:
   "remove the draft stamp completely"). That pass only reached
   src/documents/, because the Incident Report draws its pages from this
   file instead, so the stamp survived here alone for two more weeks and
   turned up on a filed report.

   The reasoning is the same one written into pdfDraw.js at the time: the
   stamp marked a document that had not been marked complete, and that
   state stopped meaning anything once finishing a document files it. A
   filed record that says DRAFT across it is worse than no stamp at all --
   and Records cannot be edited, so it says that forever.

   The `draft` and `watermarkVariant` props are gone from here and from
   every caller, rather than kept and ignored -- a prop that is threaded
   through three files and does nothing is how somebody later concludes
   the stamp is still working. The CSS that positioned it per page type is
   left in incident.css with a note, because it took several rounds to
   tune and reviving the stamp should not mean re-deriving it. */
export function IncidentPageShell({ pageRef, pageNumber, totalPages, children, className = '', headerLabel }) {
  return (
    <div ref={pageRef} className={`incidentPage ${className}`}>
      <IncidentHeader pageNumber={pageNumber} totalPages={totalPages} headerLabel={headerLabel} />
      <div className="incidentPageBody">{children}</div>
    </div>
  );
}

/* headerLabel is the FULL h2 text, verbatim -- callers that want the
   "CONTINUATION — X" wording (the text-overflow continuation pages) pass
   that whole string themselves (see ContinuationPage's own inline header
   below, which doesn't go through this component at all). The Incident
   Photo Appendix (see IncidentPageShell/buildIncidentPagePlan) is NOT a
   continuation of anything -- it's its own labeled section -- so it passes
   just "INCIDENT PHOTO APPENDIX" with no prefix. */
function IncidentHeader({ pageNumber, totalPages, headerLabel }) {
  return (
    <header className="incidentHeader">
      <div className="incidentHeaderBar">
        <img src={SHACKELFORD_LOGO} alt="Shackelford Construction and Hauling" className="incidentHeaderLogo" />
        <div className="incidentHeaderTitles">
          <h1>{FORM_TITLE}</h1>
          {headerLabel && <h2>{headerLabel}</h2>}
        </div>
        <div className="incidentHeaderPageNum">Page {pageNumber} of {totalPages}</div>
      </div>
      <div className="incidentRedRule" />
    </header>
  );
}

export function GrayBar({ children }) {
  return <div className="incGrayBar"><span className="incGrayBarTitle">{children}</span></div>;
}

/* CellContent wraps every piece of compact-cell text in a flex-centered
   inner span -- see the .incCellContent comment in incident.css for why:
   native vertical-align: middle on the <td>/<th> itself measures correctly
   centered in the live DOM but renders bottom-biased in the actual
   html2canvas raster once a cell's height is stretched taller than its own
   content (a wrapped sibling, a dynamically-grown row). The <td>/<th> stays
   a real table cell (border-collapse, column widths, height all still work
   normally); only how its content centers within that cell changes. */
function CellContent({ children, center }) {
  return <span className={`incCellContent${center ? ' center' : ''}`}>{children}</span>;
}

export function InfoTable({ rows }) {
  return (
    <table className="incInfoTable">
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              cell.isLabel
                ? <th key={j} style={cell.width ? { width: cell.width } : undefined} colSpan={cell.colSpan}><CellContent>{cell.text}</CellContent></th>
                : <td key={j} colSpan={cell.colSpan}><CellContent>{cell.text}</CellContent></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function label(text, width, colSpan) { return { isLabel: true, text, width, colSpan }; }
export function value(text, colSpan) { return { isLabel: false, text: text || '', colSpan }; }

export function TextBlock({ title, help, text, minHeightPx }) {
  return (
    <div className="incTextBlockWrap">
      {title && <div className="incTextBlockTitle">{title}</div>}
      {help && <div className="incTextBlockHelp">{help}</div>}
      <div className="incTextBlock" style={minHeightPx ? { minHeight: `${minHeightPx}px` } : undefined}>
        {text || ''}
      </div>
    </div>
  );
}

function YesNoLine({ label: lbl, val, note }) {
  return (
    <div className="incYesNoLine">
      <span className="incYesNoLabel">{lbl}:</span>
      <span className="incYesNoValue">{val === 'yes' ? 'YES' : val === 'no' ? 'NO' : '\u2014'}</span>
      {note && val === 'yes' && <span className="incYesNoNote">{note}</span>}
    </div>
  );
}

/* ── PAGE 1 ──
   The top table is a single deliberate 4-column (25% each) grid: rows that
   only need one label/value pair span the value cell across the remaining
   3 columns (colSpan=3) instead of leaving the other 2 columns of that row
   blank -- only the Date/Time-of-Incident row actually uses all 4 columns
   individually. This replaced a mixed 2-column/4-column table that left an
   unexplained blank block on the right of every other row (see v0.1.1
   polish pass).

   descriptionBoxHeightPx is computed by buildIncidentPagePlan() from a real
   measurement of everything above this box (measurePage1Budget in
   incidentPdfMeasure.js) -- it is whatever's actually left of the page, not
   a guess, so the box reaches the bottom margin regardless of how much (or
   little) room the tables above it take up (see v0.1.2 full-page-utilization
   pass). */
export function Page1Content({ incident, descriptionText, descriptionBoxHeightPx }) {
  return (
    <>
      <InfoTable rows={[
        [label('Workplace Location', '25%'), value(incident.workplaceLocation, 3)],
        [label('Date of Incident', '25%'), value(fmtDate(incident.incidentDate)), label('Time of Incident', '25%'), value(fmtTime(incident.incidentTime))],
        [label('Date/Time of Written Report', '25%'), value(fmtDateTime(incident.writtenReportDateTime), 3)],
        [label('Date/Time Reported to Supervisor', '25%'), value(fmtDateTime(incident.reportedToSupervisorDateTime), 3)],
      ]} />
      <GrayBar>SUPERINTENDENT/SUPERVISOR CONTACT INFORMATION</GrayBar>
      <InfoTable rows={[
        [label('Reporting Supervisor/Investigator Name', '32%'), value(incident.investigatorName)],
        [label('Title/Position', '32%'), value(incident.investigatorTitle)],
        [label('Contact Number', '32%'), value(incident.investigatorPhone)],
        [label('Email Address', '32%'), value(incident.investigatorEmail)],
      ]} />
      <InfoTable rows={[
        [label('Where the Incident Occurred (specify)', '32%'), value(incident.incidentSpecificLocation)],
      ]} />
      <TextBlock title="DETAILED DESCRIPTION OF THE INCIDENT" text={descriptionText} minHeightPx={descriptionBoxHeightPx} />
    </>
  );
}

/* ── PAGE 2 ──
   Always renders the full reference-form structure (injured-party fields,
   remarks, body diagram) regardless of the Yes/No answer -- when Injury is
   No, every detail field prints "N/A" and the diagram prints clean (no
   marks) instead of collapsing the whole section to one generic sentence,
   so the printed page always matches the reference form's layout. */
export function Page2Content({ incident }) {
  const injured = incident.injuryOccurred === 'yes';
  const na = v => (injured ? (v || 'N/A') : 'N/A');
  return (
    <>
      <YesNoLine label="INJURY" val={incident.injuryOccurred} note="(see details below)" />
      <GrayBar>INJURED PARTY</GrayBar>
      <InfoTable rows={[
        [label('Name, Title, Years in Company & Current Trade', '38%'), value(na([incident.injuredPartyName, incident.injuredPartyTitle, incident.injuredPartyYearsWithCompany, incident.injuredPartyCurrentTrade].filter(Boolean).join(' \u2022 ')))],
        [label('Contact Info (phone)', '38%'), value(na(incident.injuredPartyPhone))],
        [label('Contact Info (email)', '38%'), value(na(incident.injuredPartyEmail))],
        // The paper form says "circle one"; this app deliberately allows more
        // than one, because a real injury is often a laceration AND a burn.
        // The printed label says so rather than contradicting the page.
        [label('Nature of Injury (select all that apply)', '38%'), value(na((incident.injuryNature || []).join(', ') + (incident.injuryNature?.includes('Other') && incident.injuryNatureOther ? ` (${incident.injuryNatureOther})` : '')))],
        [label('Body Part(s) Affected', '38%'), value(na(incident.bodyPartsAffectedText))],
        [label('Treatment', '38%'), value(na(incident.treatmentLevel === 'firstAid' ? 'First aid' : incident.treatmentLevel === 'beyondFirstAid' ? 'Services beyond first aid' : ''))],
        [label('Physician/Clinic for First Aid Treatment', '38%'), value(na(incident.treatingPhysicianOrClinic))],
      ]} />
      <TextBlock title="Remarks/Comments" text={injured ? (incident.injuryRemarks || '') : 'N/A'} minHeightPx={40} />
      <div className="incBodyDiagramSection">
        <div className="incTextBlockTitle">PART OF BODY AFFECTED (MARK ALL AREAS THAT APPLY)</div>
        <div className="incidentBodyDiagramPrint">
          <div className="incidentBodyDiagramImageWrap" style={{ aspectRatio: BODY_DIAGRAM_ASPECT }}>
            <img src={BODY_DIAGRAM_SRC} alt="Body diagram" className="incidentBodyDiagramImage" />
            {injured && (incident.bodyDiagramMarks || []).map(m => (
              <span key={m.id} className="incidentBodyDiagramMark" style={{ left: `${m.xPct}%`, top: `${m.yPct}%` }} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Witness subsection (shared by pages 3 & 4) ──
   Always renders the full name/contact/statement/signature structure --
   for an unused witness slot (witness == null), every field prints "N/A"
   instead of collapsing the block to a single N/A box, so pages 3-4 always
   match the reference form's three-witness layout.

   statementBoxHeightPx is computed per-page by buildIncidentPagePlan() from
   a real measurement of that page's remaining space (measurePage3Budget /
   measurePage4Budget in incidentPdfMeasure.js), shared fairly between
   whichever witness blocks appear on that page -- see v0.1.2
   full-page-utilization pass. */
export function WitnessBlock({ index, witness, statementText, statementBoxHeightPx }) {
  const w = witness || {};
  const na = v => (witness ? (v || 'N/A') : 'N/A');
  return (
    <>
      <GrayBar>WITNESS {index}</GrayBar>
      <InfoTable rows={[
        [label('Name', '22%'), value(na(w.name)), label('Company', '22%'), value(na(w.company))],
        [label('Supervisor', '22%'), value(na(w.supervisor)), label('Phone', '22%'), value(na(w.phone))],
        [label('Email', '22%'), value(na(w.email)), label('Date', '22%'), value(witness && w.signatureDate ? fmtDate(w.signatureDate) : 'N/A')],
      ]} />
      <TextBlock title="Statement" text={witness ? (statementText || '') : 'N/A'} minHeightPx={statementBoxHeightPx} />
      <table className="incInfoTable incSignatureTable">
        <tbody>
          <tr>
            <th style={{ width: '18%' }}><CellContent>Signature</CellContent></th>
            <td className="incSignatureCell">
              <CellContent center>
                {w.signatureData
                  ? <img src={w.signatureData} alt="Witness signature" className="incSignatureImage" />
                  : <span className="incNotApplicableInline">{witness ? 'Not signed' : 'N/A'}</span>}
              </CellContent>
            </td>
            <th style={{ width: '14%' }}><CellContent>Date</CellContent></th>
            <td><CellContent>{witness && w.signatureDate ? fmtDate(w.signatureDate) : 'N/A'}</CellContent></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/* ── PAGE 3 ──
   statementBoxHeights is [witness1Height, witness2Height] from
   measurePage3Budget -- the two boxes share whatever's genuinely left on
   the page after both witnesses' real contact/signature chrome, in
   proportion to how much each statement actually needs (see
   allocateAndFillFlexibleSections in incidentPdfGenerate.jsx). */
export function Page3Content({ incident, statementChunks, statementBoxHeights }) {
  return (
    <>
      <GrayBar>WITNESS AND/OR WITNESS STATEMENT</GrayBar>
      <WitnessBlock index={1} witness={incident.witnesses[0]} statementText={statementChunks[0]?.[0]} statementBoxHeightPx={statementBoxHeights?.[0]} />
      <WitnessBlock index={2} witness={incident.witnesses[1]} statementText={statementChunks[1]?.[0]} statementBoxHeightPx={statementBoxHeights?.[1]} />
    </>
  );
}

/* ── PAGE 4 ──
   The four-row property-damage table always renders; when Property Damage
   is No, every detail field prints "N/A" instead of the table disappearing.
   witness3BoxHeightPx (from measurePage4Budget) is whatever's left after the
   property-damage table's own real (data-dependent) height -- the
   property-damage section stays fixed/complete and Witness 3's statement
   expands to fill the rest, so it never gets pushed off or clipped. */
export function Page4Content({ incident, statementChunks, witness3BoxHeightPx }) {
  const damaged = incident.propertyDamageOccurred === 'yes';
  const na = v => (damaged ? (v || 'N/A') : 'N/A');
  return (
    <>
      <WitnessBlock index={3} witness={incident.witnesses[2]} statementText={statementChunks[2]?.[0]} statementBoxHeightPx={witness3BoxHeightPx} />
      <YesNoLine label="PROPERTY DAMAGE" val={incident.propertyDamageOccurred} note="(see details below)" />
      <InfoTable rows={[
        [label('List Property/Material Damaged', '38%'), value(na(incident.propertyOrMaterialDamaged))],
        [label('Nature of Damage', '38%'), value(na(incident.natureOfDamage))],
        [label('Object(s)/Machine(s)/Tool(s)/Substance(s) Inflicting Damage', '38%'), value(na(incident.objectMachineToolOrSubstance))],
        [label('Approximate Cost of Damage', '38%'), value(na(incident.approximateDamageCost))],
      ]} />
    </>
  );
}

/* ── PAGE 5 -- Cause Analysis ──
   Every category's "Other" option is the final item in its items[] array
   (see incidentModel.js), so it always lands in the table's last row. That
   row renders the entered free-text directly inline (selection indicator +
   "Other (specify):" + text + primary asterisk) instead of a plain
   checklist row, matching the reference document -- there is deliberately
   no separate "Other" section below the table (that would duplicate the
   same three fields a second time). */
export function Page5Content({ incident }) {
  const maxRows = Math.max(...CAUSE_CATEGORIES.map(c => c.items.length));
  return (
    <>
      <div className="incCauseIntro">
        WHY DID THE INCIDENT OCCUR? SELECT ALL THAT APPLY &amp; PUT AN ASTERISK (*) BY THE ONE THAT BEST APPLIES AS THE PRIMARY, ROOT CAUSE, IF POSSIBLE.
      </div>
      <table className="incCauseTable">
        <thead>
          <tr>{CAUSE_CATEGORIES.map(c => <th key={c.id}><CellContent center>{c.label}</CellContent></th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRows }).map((_, rowIdx) => (
            <tr key={rowIdx}>
              {CAUSE_CATEGORIES.map(cat => {
                const item = cat.items[rowIdx];
                if (item == null) return <td key={cat.id} />;
                const key = causeKey(cat.id, item);
                const checked = (incident.selectedCauses || []).includes(key);
                const isPrimary = incident.primaryCause === key;
                const isOtherRow = item === 'Other';
                return (
                  <td key={cat.id} className={checked ? 'incCauseChecked' : ''}>
                    {/* The checkbox+text pair is wrapped as one group so the
                        JS-computed padding pass (centerCompactCellContent in
                        incidentPdfGenerate.jsx) centers it as a unit within
                        the cell; vertical-align: text-top on the checkbox
                        (incident.css) keeps it pinned to the first line
                        inside that group regardless of applied padding. */}
                    <span className="incCellContent">
                      <span className={`incCheckbox${checked ? ' checked' : ''}`}>{checked ? '\u2713' : ''}</span>
                      <span className="incCauseItemText">
                        {isOtherRow ? `Other (specify): ${incident[cat.otherField] || ''}` : item}
                        {isPrimary ? ' *' : ''}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ── PAGE 6 ──
   The investigation-team table always renders all 4 reference-form rows.
   Existing members populate rows in order; unused rows print blank (not an
   N/A box) -- an incomplete team just hasn't been filled in yet, which is
   different from a deliberate "not applicable" answer.

   teamRowHeightPx (from buildIncidentPagePlan's page-6 allocation) grows the
   table's rows beyond their CSS-default minimum with whatever genuine
   leftover space remains after the two notes boxes get what they actually
   need, so the table -- not empty space below it -- reaches the bottom
   margin (see v0.1.2 full-page-utilization pass). Applied as a CSS custom
   property so incident.css's own rule stays the single source of the
   default (40px) if this prop is ever omitted. */
export function Page6Content({
  incident, supervisorNotesChunk, safetyConsultantNotesChunk,
  supervisorNotesBoxHeight, safetyConsultantNotesBoxHeight, teamRowHeightPx,
}) {
  const team = incident.investigationTeam || [];
  const rows = Array.from({ length: 4 }).map((_, i) => team[i] || null);
  return (
    <>
      <GrayBar>SUPERINTENDENT/SUPERVISOR NOTES &amp; SUMMARY</GrayBar>
      <TextBlock help={SUPERVISOR_NOTES_HELP} text={supervisorNotesChunk} minHeightPx={supervisorNotesBoxHeight || MIN_NOTE_BOX_HEIGHT_PX} />
      <GrayBar>SAFETY CONSULTANT NOTES &amp; SUMMARY</GrayBar>
      <TextBlock text={safetyConsultantNotesChunk} minHeightPx={safetyConsultantNotesBoxHeight || MIN_NOTE_BOX_HEIGHT_PX} />
      <GrayBar>INVESTIGATION TEAM</GrayBar>
      <table className="incInfoTable incTeamTable" style={{ '--incTeamRowHeight': `${teamRowHeightPx || MIN_TEAM_ROW_HEIGHT_PX}px` }}>
        <thead>
          <tr>
            <th><CellContent>Name</CellContent></th>
            <th><CellContent>Title</CellContent></th>
            <th><CellContent center>Signature</CellContent></th>
            <th><CellContent>Date</CellContent></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m?.id || `empty-${i}`}>
              <td><CellContent>{m?.name || ''}</CellContent></td>
              <td><CellContent>{m?.title || ''}</CellContent></td>
              <td><CellContent center>{m?.signatureData ? <img src={m.signatureData} alt="Signature" className="incSignatureImage" /> : ''}</CellContent></td>
              <td><CellContent>{m?.date ? fmtDate(m.date) : ''}</CellContent></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ── Incident Photo Appendix ──
   Appended AFTER all six base pages and any text-overflow continuation
   pages -- never mixed into them (see buildIncidentPagePlan in
   incidentPdfGenerate.jsx, which only adds these when the incident has at
   least one photo). Up to two photos per page, stacked vertically so
   portrait and landscape photos both get the full content width and just
   use object-fit: contain within a fixed-height frame -- nothing is ever
   stretched or cropped. photoUrls is `{ [photoId]: { url, status } }` from
   useIncidentPhotoUrls.js; a photo whose blob hasn't loaded (or is
   missing/corrupted) renders a plain-language placeholder instead of a
   broken image, both on screen and in the exported PDF. */
function PhotoAppendixBlock({ photo, urlEntry }) {
  const ready = urlEntry?.status === 'ready' && urlEntry.url;
  const label = urlEntry?.status === 'missing' || urlEntry?.status === 'error' ? 'Photo unavailable' : 'Loading photo…';
  return (
    <div className="incPhotoBlock">
      <div className="incPhotoFrame" style={{ height: `${PHOTO_FRAME_HEIGHT_PX}px` }}>
        {ready
          ? <img src={urlEntry.url} alt={photo.caption || photo.category || 'Incident photo'} className="incPhotoImage" />
          : <div className="incPhotoPlaceholder">{label}</div>}
      </div>
      {(photo.category || photo.caption) && (
        <div className="incPhotoCaptionBar">
          {photo.category && <span className="incPhotoCategoryTag">{photo.category}</span>}
          {photo.caption && <span className="incPhotoCaptionText">{photo.caption}</span>}
        </div>
      )}
    </div>
  );
}

export function PhotoAppendixContent({ photos, photoUrls }) {
  return (
    <div className="incPhotoAppendixPage" style={{ gap: `${PHOTO_BLOCK_GAP_PX}px` }}>
      {(photos || []).map(photo => (
        <PhotoAppendixBlock key={photo.id} photo={photo} urlEntry={photoUrls?.[photo.id]} />
      ))}
    </div>
  );
}

/* ── Generic continuation page for overflowing long-text fields ── */
export function ContinuationPage({ sectionLabel, text, pageNumber, totalPages, incident, pageRef }) {
  return (
    <div ref={pageRef} className="incidentPage incidentContinuationPage">
      <header className="incidentHeader">
        <div className="incidentHeaderBar">
          <img src={SHACKELFORD_LOGO} alt="Shackelford Construction and Hauling" className="incidentHeaderLogo" />
          <div className="incidentHeaderTitles">
            <h1>{FORM_TITLE}</h1>
            <h2>CONTINUATION &mdash; {sectionLabel}</h2>
          </div>
          <div className="incidentHeaderPageNum">Page {pageNumber} of {totalPages}</div>
        </div>
        <div className="incidentRedRule" />
      </header>
      <div className="incidentPageBody">
        <div className="incContinuationMeta">
          <span><strong>Workplace Location:</strong> {incident.workplaceLocation || '\u2014'}</span>
          <span><strong>Incident Date:</strong> {fmtDate(incident.incidentDate) || '\u2014'}</span>
          <span><strong>Continued Section:</strong> {sectionLabel}</span>
        </div>
        <div className="incTextBlock incTextBlockContinuation">{text}</div>
      </div>
    </div>
  );
}
