/* Employee Separation, drawn straight into the PDF. See pdfDraw.js. */

import { createFormPdf, loadLogoPngBytes, fmtDate } from '../pdfDraw';
import {
  SEPARATION_TYPES, SEPARATION_REASONS, REHIRE_STATUSES,
  PROPERTY_RETURNED_OPTIONS, ACCESS_REMOVED_OPTIONS,
  isSeparationPrintFinal,
} from './separationModel';

const FORM_TITLE = 'EMPLOYEE SEPARATION FORM';
/* One label-column width for every full-width label/value table on this form,
   so the rule between label and answer lines up all the way down the page. */
const LABEL_W = 0.32;

function optionLabel(options, v) {
  return options.find(o => o.value === v)?.label || '';
}

export async function drawSeparationPdf(model, onProgress) {
  onProgress?.(1, 1);
  const logoBytes = await loadLogoPngBytes(`${import.meta.env.BASE_URL}icons/shackelford-logo.webp`);
  const doc = await createFormPdf({
    formTitle: FORM_TITLE,
    logoBytes,
    draft: !isSeparationPrintFinal(model),
  });

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
    'Expenses / Receipts Resolved?', model.expensesResolved ? 'Yes' : 'No',
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
  const employeeItem = model.employeeRefusedToSign
    ? { label: 'Employee Signature', note: 'Refused / Unavailable to Sign' }
    : {
      label: 'Employee Signature',
      image: await doc.embedSignature(model.employeeSignatureData),
      dateValue: fmtDate(model.employeeSignatureDate),
    };
  doc.multiSignatureRow([
    employeeItem,
    {
      label: 'Supervisor Signature',
      image: await doc.embedSignature(model.supervisorSignatureData),
      dateValue: fmtDate(model.supervisorSignatureDate),
    },
    {
      label: `HR / Management${model.hrName ? ` — ${model.hrName}` : ''}`,
      image: await doc.embedSignature(model.hrSignatureData),
      dateValue: fmtDate(model.hrSignatureDate),
    },
  ]);

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
    'Expenses / Receipts Resolved?', model.expensesResolved ? 'Yes' : 'No',
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
  const employeeItem = model.employeeRefusedToSign
    ? { label: 'Employee Signature', note: 'Refused / Unavailable to Sign' }
    : {
      label: 'Employee Signature',
      dataUrl: model.employeeSignatureData,
      dateValue: fmtDate(model.employeeSignatureDate),
    };
  blocks.push({
    type: 'multiSignatureRow',
    items: [
      employeeItem,
      { label: 'Supervisor Signature', dataUrl: model.supervisorSignatureData, dateValue: fmtDate(model.supervisorSignatureDate) },
      { label: `HR / Management${model.hrName ? ` — ${model.hrName}` : ''}`, dataUrl: model.hrSignatureData, dateValue: fmtDate(model.hrSignatureDate) },
    ],
  });

  return blocks;
}
