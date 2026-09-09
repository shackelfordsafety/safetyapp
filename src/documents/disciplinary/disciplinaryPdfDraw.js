/* Employee Disciplinary Notice, drawn straight into the PDF.

   A sequence of stencil calls, not DOM to be photographed. Read it top to
   bottom and you are reading the printed page top to bottom.

   See pdfDraw.js for why this exists and what it makes impossible. */

import { createFormPdf, loadLogoPngBytes, fmtDate } from '../pdfDraw';
import { WARNING_LEVELS, warningLevelLabel,  isVerbalWarning } from './disciplinaryModel';

// Verbal warnings are a coaching conversation, not a signed notice -- the
// employee never signs (see DisciplinaryWorkflow.jsx's StepResponse). Shared
// by the real PDF draw and the review-screen facsimile so the two note texts
// can't drift apart.
function employeeSigNote(model) {
  if (isVerbalWarning(model)) return 'Verbal Warning — No Employee Signature Required';
  if (model.employeeRefusedToSign) return 'Refused / Unavailable to Sign';
  return null;
}

const FORM_TITLE = 'EMPLOYEE DISCIPLINARY NOTICE FORM';

/* Section wording is the paper form's own, verbatim — see the 2026-08-12
   source-fidelity audit. Sections 2 and 5 had been shortened. */
const SECTIONS = [
  [1, 'What occurred', 'whatOccurred'],
  [2, 'Earlier verbal or written warnings, discussions, etc. on this issue', 'earlierWarnings'],
  [3, 'Company policy states', 'companyPolicyStates'],
  [4, 'Employee statement', 'employeeStatement'],
  [5, 'Corrective action that must be taken by the employee', 'correctiveActionRequired'],
  [6, 'The company will', 'companyWill'],
  [7, 'If behavior is not corrected/performance does not improve', 'ifNotCorrected'],
];

// A verbal warning is a coaching conversation -- there's no formal statement
// to take down, so section 4 is skipped (numbering intentionally keeps its
// gap rather than renumbering, matching the paper form's own section
// numbers used elsewhere, e.g. the "Section 5" readiness-check label).
function sectionsForModel(model) {
  return isVerbalWarning(model) ? SECTIONS.filter(([number]) => number !== 4) : SECTIONS;
}

export async function drawDisciplinaryPdf(model, onProgress) {
  onProgress?.(1, 1);
  const logoBytes = await loadLogoPngBytes(`${import.meta.env.BASE_URL}icons/shackelford-logo.webp`);
  const doc = await createFormPdf({
    formTitle: FORM_TITLE,
    logoBytes,  });

  // Field order is the paper form's: Name | Supervisor, then Position | Date.
  doc.infoTable([
    ['Employee Name', model.employeeName, 'Supervisor', model.supervisor],
    ['Position', model.position, 'Date', fmtDate(model.noticeDate)],
  ], 0.19);

  doc.space(6);
  // The paper form introduces the boxes with a sentence, not a section label.
  doc.fieldLabel('This notice serves as:', { caps: false });
  doc.checkboxGrid({
    options: WARNING_LEVELS.map(w => w.label),
    checked: warningLevelLabel(model.warningLevel),
    columns: 4,
  });

  for (const [number, title, field] of sectionsForModel(model)) {
    doc.space(5);
    doc.numberedBar(number, title);
    // 40pt ~= two written lines plus padding. Sized so a notice with short
    // answers still lands both signature rows on page 1 rather than pushing
    // the manager's signature onto a near-empty second page.
    doc.textBox({ text: model[field], minH: 40 });
  }

  doc.space(8);
  doc.grayBar('Signatures');
  const empNote = employeeSigNote(model);
  doc.signatureRow(empNote
    ? { label: 'Employee Signature', note: empNote }
    : {
      label: 'Employee Signature',
      image: await doc.embedSignature(model.employeeSignatureData),
      dateValue: fmtDate(model.employeeSignatureDate),
    });
  doc.signatureRow({
    label: 'Manager Signature',
    image: await doc.embedSignature(model.managerSignatureData),
    dateValue: fmtDate(model.managerSignatureDate),
  });

  return doc.finish();
}

/* Review-screen facsimile — mirrors drawDisciplinaryPdf's call sequence
   above block-for-block (see DocFacsimile in FormPrimitives.jsx). Keep
   these two in sync: a field added to one belongs in the other. */
export function disciplinaryFacsimileBlocks(model) {
  const blocks = [];
  blocks.push({ type: 'infoTable', rows: [
    ['Employee Name', model.employeeName, 'Supervisor', model.supervisor],
    ['Position', model.position, 'Date', fmtDate(model.noticeDate)],
  ] });

  blocks.push({ type: 'fieldLabel', text: 'This notice serves as:', caps: false });
  blocks.push({
    type: 'checkboxGrid',
    options: WARNING_LEVELS.map(w => w.label),
    checked: warningLevelLabel(model.warningLevel),
    columns: 4,
  });

  for (const [number, title, field] of sectionsForModel(model)) {
    blocks.push({ type: 'numberedBar', number, text: title });
    blocks.push({ type: 'textBox', text: model[field] });
  }

  blocks.push({ type: 'grayBar', text: 'Signatures' });
  const empNote = employeeSigNote(model);
  blocks.push({
    type: 'signatureRow',
    label: 'Employee Signature',
    ...(empNote
      ? { note: empNote }
      : { dataUrl: model.employeeSignatureData, dateValue: fmtDate(model.employeeSignatureDate) }),
  });
  blocks.push({
    type: 'signatureRow',
    label: 'Manager Signature',
    dataUrl: model.managerSignatureData,
    dateValue: fmtDate(model.managerSignatureDate),
  });

  return blocks;
}
