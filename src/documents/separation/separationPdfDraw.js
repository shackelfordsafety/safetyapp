/* Employee Separation, drawn straight into the PDF. See pdfDraw.js. */

import { createFormPdf, loadLogoPngBytes, fmtDate } from '../pdfDraw';
import {
  SEPARATION_TYPES, SEPARATION_REASONS, REHIRE_STATUSES,
  PROPERTY_RETURNED_OPTIONS, ACCESS_REMOVED_OPTIONS, expensesAnswer, EXPENSES_ANSWER_LABELS,
  
} from './separationModel';

const FORM_TITLE = 'EMPLOYEE SEPARATION FORM';
/* One label-column width for every full-width label/value table on this form,
   so the rule between label and answer lines up all the way down the page. */
const LABEL_W = 0.32;

function optionLabel(options, v) {
  return options.find(o => o.value === v)?.label || '';
}

/* What goes on the ruled line under a signature.
   Fonzo, 2026-09-14, looking at a real signed separation: "why is the name
   not under the signature line... we need to make it so the person's name
   that's signing is underneath their signature and the dates right next to
   it."

   It used to print the ROLE there -- "Employee Signature", "Supervisor
   Signature" -- which tells a reader what the box is for and not who signed
   it. A separation is read back months later by somebody who was not in the
   room; the name is the whole point. HR was the one exception and it was
   done backwards, "HR / Management — Alfonso Hernandez", so the role pushed
   the name onto a second line.

   Name first, role after, and the role alone when nobody has been named --
   an unnamed line still has to read as a form. */
function signatureLine(role, name) {
  const who = String(name || '').trim();
  return who ? `${who} — ${role}` : role;
}

/* The three people who sign this in the room, in the order they sign it.
   Fonzo, 2026-09-14: "why can't we just make it to where there's three
   boxes only there?"

   It was three boxes plus a fourth, full-width witness row underneath,
   which read as an afterthought and spilled onto a second page. HR was one
   of the three and should not have been -- she is not in the room, she
   signs when the notice reaches her, and her empty box was what pushed the
   witness out.

   ONE definition, used by both the PDF and the Review facsimile. Those two
   are separate block lists that are supposed to mirror each other and had
   already drifted once -- the witness printed in the PDF and was missing
   from the preview entirely. Sharing the definition is what stops that
   happening a second time. */
function approvalPeople(model) {
  return [
    model.employeeRefusedToSign
      ? { label: signatureLine('Employee', model.employeeName), note: 'Refused / Unavailable to Sign' }
      : {
        label: signatureLine('Employee', model.employeeName),
        dataUrl: model.employeeSignatureData,
        dateValue: fmtDate(model.employeeSignatureDate),
      },
    {
      label: signatureLine('Management', model.managerName),
      dataUrl: model.supervisorSignatureData,
      dateValue: fmtDate(model.supervisorSignatureDate),
    },
    {
      label: signatureLine('Witness', model.witnessName),
      dataUrl: model.witnessSignatureData,
      dateValue: fmtDate(model.witnessSignatureDate),
    },
  ];
}

/* The PDF draws embedded images; the facsimile renders data URLs. Same
   items, one conversion. */
async function withEmbeddedSignatures(doc, items) {
  return Promise.all(items.map(async (it) => (it.dataUrl
    ? { ...it, image: await doc.embedSignature(it.dataUrl) }
    : it)));
}

export async function drawSeparationPdf(model, onProgress) {
  onProgress?.(1, 1);
  const logoBytes = await loadLogoPngBytes(`${import.meta.env.BASE_URL}icons/shackelford-logo.webp`);
  const doc = await createFormPdf({
    formTitle: FORM_TITLE,
    logoBytes,  });

  doc.infoTable([
    ['Employee Name', model.employeeName, 'Position', model.position],
    ['Project / Location', model.projectLocation, 'Supervisor', model.supervisor],
    ['Last Day Worked', fmtDate(model.lastDayWorked), 'Effective Separation Date', fmtDate(model.effectiveSeparationDate)],
    ['Date Submitted', fmtDate(model.dateSubmitted)],
  ], 0.19);

  doc.space(6);
  doc.grayBar('Separation Type / Reason');
  doc.checkboxGrid({
    options: SEPARATION_TYPES.map(t => t.label),
    checked: optionLabel(SEPARATION_TYPES, model.separationType),
    columns: 2,
  });
  doc.checkboxGrid({ options: SEPARATION_REASONS, checked: model.separationReason, columns: 2 });
  const reasonLabel = model.separationReason === 'Other' && model.separationReasonOther
    ? `Other — ${model.separationReasonOther}`
    : model.separationReason;
  doc.infoTable([['Reason', reasonLabel]], LABEL_W);

  doc.space(6);
  doc.grayBar('Explanation / Supporting Details');
  doc.textBox({ text: model.detailedExplanation, minH: 46 });

  doc.space(6);
  doc.grayBar('Discipline / Rehire Status');
  const disciplineRows = [];
  if (model.separationType === 'involuntary') {
    const warningText = model.warningNoticesGiven === 'yes'
      ? `Yes — ${model.warningNoticesCount || 'count not specified'}`
      : model.warningNoticesGiven === 'no' ? 'No' : model.warningNoticesGiven === 'na' ? 'N/A' : '';
    disciplineRows.push(['Warning Notices Given?', warningText]);
  }
  disciplineRows.push(['Eligible for Rehire?', optionLabel(REHIRE_STATUSES, model.eligibleForRehire)]);
  if (model.eligibleForRehire === 'no') disciplineRows.push(['Reason Not Eligible', model.rehireReasonIfNo]);
  doc.infoTable(disciplineRows, LABEL_W);

  doc.space(6);
  doc.grayBar('Company Closeout');
  doc.infoTable([[
    'Final Timesheet Submitted?', model.finalTimesheetSubmitted ? 'Yes' : 'No',
    'Expenses / Receipts Resolved?', EXPENSES_ANSWER_LABELS[expensesAnswer(model)],
  ]], 0.3);

  const withOther = (opts, otherText) => (otherText ? opts.map(o => (o === 'Other' ? `Other — ${otherText}` : o)) : opts);
  const mapChecked = (checked, otherText) => (checked || []).map(o => (o === 'Other' && otherText ? `Other — ${otherText}` : o));
  doc.checkboxGrid({
    options: withOther(PROPERTY_RETURNED_OPTIONS, model.propertyReturnedOther),
    checked: mapChecked(model.propertyReturned, model.propertyReturnedOther),
  });
  doc.checkboxGrid({
    options: withOther(ACCESS_REMOVED_OPTIONS, model.accessRemovedOther),
    checked: mapChecked(model.accessRemoved, model.accessRemovedOther),
  });

  doc.space(4);
  doc.textBox({ title: 'Outstanding Property / Notes', text: model.outstandingPropertyNotes, minH: 24 });

  doc.space(6);
  doc.grayBar('Acknowledgement / Approvals');
  /* This sentence is the reason an employee can sign a separation form
     without it meaning they agree with it. It belongs on the copy they keep,
     not only on the screen the supervisor filled in. */
  doc.note('Employee signature acknowledges receipt and does not necessarily indicate agreement.');
  /* The witness statement belongs ABOVE the boxes, with the other note --
     it is context for the row, not a heading for a fourth row of its own.
     Printed only when there is a witness. */
  if (model.witnessSignatureData || model.witnessName) {
    doc.note(model.witnessStatement || 'I was present when this separation was discussed.');
  }
  /* THREE BOXES, AND THAT IS THE WHOLE LIST. HR does not sign a separation
     at all. Fonzo, 2026-09-15, after asking her outright: "I talked to Miss
     Pat, the HR manager, she said she doesn't need to sign on anything,
     signing people are only in the field, she's just the approver."

     So the fourth line is gone rather than conditional. It approves in the
     app -- her name is on the approval, with a timestamp, in the record --
     and a signature line for somebody who is never going to sign is just a
     blank that makes a filed form look unfinished.

     hrName / hrSignatureData / hrSignatureDate stay in the data shape (see
     separationModel) so a draft saved before today still loads. They simply
     stop being drawn. */
  doc.keepTogether(60);
  doc.multiSignatureRow(await withEmbeddedSignatures(doc, approvalPeople(model)));

  return doc.finish();
}

/* Review-screen facsimile — mirrors drawSeparationPdf's call sequence
   above block-for-block (see DocFacsimile in FormPrimitives.jsx). Keep
   these two in sync: a field added to one belongs in the other. */
export function separationFacsimileBlocks(model) {
  const blocks = [];
  blocks.push({ type: 'infoTable', rows: [
    ['Employee Name', model.employeeName, 'Position', model.position],
    ['Project / Location', model.projectLocation, 'Supervisor', model.supervisor],
    ['Last Day Worked', fmtDate(model.lastDayWorked), 'Effective Separation Date', fmtDate(model.effectiveSeparationDate)],
    ['Date Submitted', fmtDate(model.dateSubmitted)],
  ] });

  blocks.push({ type: 'grayBar', text: 'Separation Type / Reason' });
  blocks.push({
    type: 'checkboxGrid',
    options: SEPARATION_TYPES.map(t => t.label),
    checked: optionLabel(SEPARATION_TYPES, model.separationType),
    columns: 2,
  });
  blocks.push({ type: 'checkboxGrid', options: SEPARATION_REASONS, checked: model.separationReason, columns: 2 });
  const reasonLabel = model.separationReason === 'Other' && model.separationReasonOther
    ? `Other — ${model.separationReasonOther}`
    : model.separationReason;
  blocks.push({ type: 'infoTable', rows: [['Reason', reasonLabel]] });

  blocks.push({ type: 'grayBar', text: 'Explanation / Supporting Details' });
  blocks.push({ type: 'textBox', text: model.detailedExplanation });

  blocks.push({ type: 'grayBar', text: 'Discipline / Rehire Status' });
  const disciplineRows = [];
  if (model.separationType === 'involuntary') {
    const warningText = model.warningNoticesGiven === 'yes'
      ? `Yes — ${model.warningNoticesCount || 'count not specified'}`
      : model.warningNoticesGiven === 'no' ? 'No' : model.warningNoticesGiven === 'na' ? 'N/A' : '';
    disciplineRows.push(['Warning Notices Given?', warningText]);
  }
  disciplineRows.push(['Eligible for Rehire?', optionLabel(REHIRE_STATUSES, model.eligibleForRehire)]);
  if (model.eligibleForRehire === 'no') disciplineRows.push(['Reason Not Eligible', model.rehireReasonIfNo]);
  blocks.push({ type: 'infoTable', rows: disciplineRows });

  blocks.push({ type: 'grayBar', text: 'Company Closeout' });
  blocks.push({ type: 'infoTable', rows: [[
    'Final Timesheet Submitted?', model.finalTimesheetSubmitted ? 'Yes' : 'No',
    'Expenses / Receipts Resolved?', EXPENSES_ANSWER_LABELS[expensesAnswer(model)],
  ]] });

  const withOther = (opts, otherText) => (otherText ? opts.map(o => (o === 'Other' ? `Other — ${otherText}` : o)) : opts);
  const mapChecked = (checked, otherText) => (checked || []).map(o => (o === 'Other' && otherText ? `Other — ${otherText}` : o));
  blocks.push({
    type: 'checkboxGrid',
    options: withOther(PROPERTY_RETURNED_OPTIONS, model.propertyReturnedOther),
    checked: mapChecked(model.propertyReturned, model.propertyReturnedOther),
  });
  blocks.push({
    type: 'checkboxGrid',
    options: withOther(ACCESS_REMOVED_OPTIONS, model.accessRemovedOther),
    checked: mapChecked(model.accessRemoved, model.accessRemovedOther),
  });
  blocks.push({ type: 'textBox', title: 'Outstanding Property / Notes', text: model.outstandingPropertyNotes });

  blocks.push({ type: 'grayBar', text: 'Acknowledgement / Approvals' });
  blocks.push({ type: 'note', text: 'Employee signature acknowledges receipt and does not necessarily indicate agreement.' });
  if (model.witnessSignatureData || model.witnessName) {
    blocks.push({ type: 'note', text: model.witnessStatement || 'I was present when this separation was discussed.' });
  }
  blocks.push({ type: 'multiSignatureRow', items: approvalPeople(model) });
  /* No HR row here either -- HR does not sign, see drawSeparationPdf. This
     list and the PDF above are supposed to mirror each other block for
     block, and they have already drifted apart once. */

  return blocks;
}
