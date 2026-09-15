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

/* What goes on the ruled line under a signature: the person who signed,
   then their role. Same rule as the separation form, for the same reason --
   a write-up is read back months later by somebody who was not in the room,
   and "Management Signature" says what the box is for, not who gave the
   notice. Role alone when nobody is named, because an unsigned line still
   has to read as a form.

   Shared by the real PDF and the Review facsimile below, so the two cannot
   drift apart -- which they had already done on the separation form, where
   the witness printed on paper and was missing from the preview. */
function signatureLine(role, name) {
  const who = String(name || '').trim();
  return who ? `${who} — ${role}` : role;
}

/* THE THREE PEOPLE IN THE ROOM, laid out exactly like the separation form.
   Fonzo, 2026-09-15: "make disciplinary match separation."

   Until now these two forms printed signatures two different ways -- this
   one stacked them full-width down the page with the date off in its own
   right-hand column, while the separation put three side by side with the
   date under the name. Both obeyed his earlier rule that the name goes
   under the signature, and they still looked like paperwork from two
   different companies.

   The witness box prints whether or not anybody signed it, the way the
   separation's always has. An employee refusing to sign a write-up is the
   normal case, not the edge one, and a blank line that was there to be used
   says something a line that was never offered does not.

   ONE definition, shared by the real PDF and the Review facsimile below,
   so the two cannot drift apart. */
function approvalPeople(model) {
  const empNote = employeeSigNote(model);
  return [
    empNote
      ? { label: signatureLine('Employee', model.employeeName), note: empNote }
      : {
        label: signatureLine('Employee', model.employeeName),
        dataUrl: model.employeeSignatureData,
        dateValue: fmtDate(model.employeeSignatureDate),
      },
    {
      label: signatureLine('Management', model.managerName),
      dataUrl: model.managerSignatureData,
      dateValue: fmtDate(model.managerSignatureDate),
    },
    {
      label: signatureLine('Witness', model.witnessName),
      dataUrl: model.witnessSignatureData,
      dateValue: fmtDate(model.witnessSignatureDate),
    },
  ];
}

/* The PDF draws embedded images; the facsimile renders data URLs. Same
   items, one conversion. Mirrors the separation's helper of the same name. */
async function withEmbeddedSignatures(doc, items) {
  return Promise.all(items.map(async (it) => (it.dataUrl
    ? { ...it, image: await doc.embedSignature(it.dataUrl) }
    : it)));
}

/* A verbal warning is the one exception to the three boxes. Nobody signs it
   but the manager -- there is no employee signature and no witness, and
   printing two boxes that say so would be louder than the notice. */
function verbalOnlyRow(model) {
  return {
    label: signatureLine('Management', model.managerName),
    dataUrl: model.managerSignatureData,
    dateValue: fmtDate(model.managerSignatureDate),
  };
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

  if (isVerbalWarning(model)) {
    doc.keepTogether(60);
    doc.multiSignatureRow(await withEmbeddedSignatures(doc, [verbalOnlyRow(model)]));
    return doc.finish();
  }

  doc.note('Employee signature acknowledges receipt and does not necessarily indicate agreement.');

  /* What the witness witnessed, ABOVE the boxes -- context for the row, not
     a heading for a row of its own. The statement carries the weight, not
     the signature: a blank employee line proves nothing about whether the
     notice was ever given, and this says somebody was there and what
     happened. Stored on the record at the moment of signing so it cannot
     drift if the form is edited afterwards. */
  if (model.witnessSignatureData || model.witnessName) {
    doc.note(model.witnessStatement || 'I was present when this was discussed.');
  }
  doc.keepTogether(60);
  doc.multiSignatureRow(await withEmbeddedSignatures(doc, approvalPeople(model)));

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

  /* Same call sequence as drawDisciplinaryPdf above, block for block --
     verbal's single row, the receipt note, the witness statement, then one
     three-across row. Sharing approvalPeople() is what keeps them honest:
     this preview and the printed copy had already drifted apart once, when
     the witness printed on paper and was missing here. */
  if (isVerbalWarning(model)) {
    blocks.push({ type: 'multiSignatureRow', items: [verbalOnlyRow(model)] });
    return blocks;
  }

  blocks.push({ type: 'note', text: 'Employee signature acknowledges receipt and does not necessarily indicate agreement.' });
  if (model.witnessSignatureData || model.witnessName) {
    blocks.push({ type: 'note', text: model.witnessStatement || 'I was present when this was discussed.' });
  }
  blocks.push({ type: 'multiSignatureRow', items: approvalPeople(model) });

  return blocks;
}
