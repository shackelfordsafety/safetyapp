/* Employee Medical Event, drawn straight into the PDF. See pdfDraw.js.

   Two-tier headings on this form: a gray bar marks a MAJOR division, the
   bare bold caption above a field marks a prompt beneath one. So
   EMPLOYEE-REPORTED CONDITION is a bar, and Symptoms / Work Event sit under
   it as labels; MEDICAL EVALUATION / WORK STATUS starts the next major
   division. */

import { createFormPdf, loadLogoPngBytes, fmtDate } from '../pdfDraw';
import {
  SYMPTOM_ONSET_OPTIONS, RESPONSE_ACTIONS, MEDICAL_EVALUATION_TYPES, WORK_STATUS_OPTIONS,
  INITIAL_CLASSIFICATIONS, MEDICAL_ATTACHMENT_OPTIONS,
  
} from './medicalEventModel';

const FORM_TITLE = 'EMPLOYEE MEDICAL EVENT FORM';

function optionLabel(options, v) {
  return options.find(o => o.value === v)?.label || '';
}

export async function drawMedicalEventPdf(model, onProgress) {
  onProgress?.(1, 1);
  const logoBytes = await loadLogoPngBytes(`${import.meta.env.BASE_URL}icons/shackelford-logo.webp`);
  const doc = await createFormPdf({
    formTitle: FORM_TITLE,
    logoBytes,  });

  // Field order is the paper form's.
  doc.infoTable([
    ['Employee Name', model.employeeName, 'Supervisor', model.supervisor],
    ['Position', model.position, 'Project / Location', model.projectLocation],
    ['Date', fmtDate(model.eventDate), 'Time Reported', model.timeReported],
  ], 0.19);

  doc.space(6);
  doc.grayBar('Employee-Reported Condition');
  doc.textBox({ title: 'Symptoms / Concerns (as reported by the employee)', text: model.reportedSymptoms, minH: 38 });
  doc.space(4);
  doc.infoTable([
    ['When Symptoms First Appeared', optionLabel(SYMPTOM_ONSET_OPTIONS, model.symptomsOnset)],
    ['Specific Work Event/Exposure Reported?',
      model.specificWorkEventReported === 'yes' ? 'Yes' : model.specificWorkEventReported === 'no' ? 'No' : ''],
  ], 0.4);
  /* The routing rule off the paper form — a work-related medical event still
     needs its own incident investigation, and this is where a supervisor
     reads that weeks later. */
  doc.note('If yes, complete the Incident Reporting and Investigation Form.');
  if (model.specificWorkEventReported === 'yes') {
    doc.space(4);
    doc.textBox({ title: 'Work Event / Exposure Reported', text: model.workEventDescription, minH: 30 });
  }

  doc.space(6);
  doc.grayBar('Response / Actions Taken');
  doc.checkboxGrid({ options: RESPONSE_ACTIONS, checked: model.responseActions });
  if ((model.responseActions || []).includes('Other') && model.responseActionsOther) {
    doc.space(4);
    doc.textBox({ title: 'Other Action', text: model.responseActionsOther, minH: 20 });
  }
  doc.space(4);
  doc.textBox({
    title: 'Safety / Supervisor Observations and Actions',
    text: model.safetyObservations,
    minH: 38,
  });

  doc.space(6);
  doc.grayBar('Medical Evaluation / Work Status');
  const evalLabel = optionLabel(MEDICAL_EVALUATION_TYPES, model.medicalEvaluationType)
    || (model.medicalEvaluationType === 'other' ? model.medicalEvaluationOther : '');
  const workStatusLabel = model.workStatus === 'offWork'
    ? `Off Work Until ${fmtDate(model.offWorkUntilDate)}`
    : model.workStatus === 'fullDuty' && model.fullDutyOnDate
      ? `Full Duty on ${fmtDate(model.fullDutyOnDate)}`
      : optionLabel(WORK_STATUS_OPTIONS, model.workStatus);
  doc.infoTable([
    ['Medical Evaluation', evalLabel, 'Clinic / Provider', model.clinicProvider],
  ], 0.19);
  doc.infoTable([['Work Status', workStatusLabel]], 0.19);

  doc.space(6);
  const attachOptions = (model.attachments || []).includes('Other') && model.attachmentOther
    ? MEDICAL_ATTACHMENT_OPTIONS.map(o => (o === 'Other' ? `Other — ${model.attachmentOther}` : o))
    : MEDICAL_ATTACHMENT_OPTIONS;
  const attachChecked = (model.attachments || [])
    .map(o => (o === 'Other' && model.attachmentOther ? `Other — ${model.attachmentOther}` : o));
  doc.twoCol(
    () => {
      doc.grayBar('Attachments');
      doc.infoTable([['Provider Note Attached', model.providerNoteAttached ? 'Yes' : 'No']], 0.55);
      doc.checkboxGrid({ options: attachOptions, checked: attachChecked, columns: 2 });
    },
    () => {
      doc.grayBar('Initial Classification');
      doc.checkboxGrid({
        options: INITIAL_CLASSIFICATIONS.map(c => c.label),
        checked: optionLabel(INITIAL_CLASSIFICATIONS, model.initialClassification),
        columns: 1,
      });
    },
  );

  doc.space(6);
  doc.grayBar('Signatures');
  /* The paper form prints Name above Signature and Date for both signers.
     A blank name falls back to whoever is already named up top, so the
     printed form never carries an empty NAME line. */
  doc.signatureRow({
    label: 'Employee Signature (if able)',
    nameValue: model.employeeSignatureName || model.employeeName,
    image: await doc.embedSignature(model.employeeSignatureData),
    dateValue: fmtDate(model.employeeSignatureDate),
  });
  doc.signatureRow({
    label: 'Safety / Supervisor Signature',
    nameValue: model.supervisorSignatureName || model.supervisor,
    image: await doc.embedSignature(model.supervisorSignatureData),
    dateValue: fmtDate(model.supervisorSignatureDate),
  });

  return doc.finish();
}

/* Review-screen facsimile — mirrors drawMedicalEventPdf's call sequence
   above block-for-block (see DocFacsimile in FormPrimitives.jsx). Keep
   these two in sync: a field added to one belongs in the other. */
export function medicalEventFacsimileBlocks(model) {
  const blocks = [];
  blocks.push({ type: 'infoTable', rows: [
    ['Employee Name', model.employeeName, 'Supervisor', model.supervisor],
    ['Position', model.position, 'Project / Location', model.projectLocation],
    ['Date', fmtDate(model.eventDate), 'Time Reported', model.timeReported],
  ] });

  blocks.push({ type: 'grayBar', text: 'Employee-Reported Condition' });
  blocks.push({ type: 'textBox', title: 'Symptoms / Concerns (as reported by the employee)', text: model.reportedSymptoms });
  blocks.push({ type: 'infoTable', rows: [
    ['When Symptoms First Appeared', optionLabel(SYMPTOM_ONSET_OPTIONS, model.symptomsOnset)],
    ['Specific Work Event/Exposure Reported?',
      model.specificWorkEventReported === 'yes' ? 'Yes' : model.specificWorkEventReported === 'no' ? 'No' : ''],
  ] });
  blocks.push({ type: 'note', text: 'If yes, complete the Incident Reporting and Investigation Form.' });
  if (model.specificWorkEventReported === 'yes') {
    blocks.push({ type: 'textBox', title: 'Work Event / Exposure Reported', text: model.workEventDescription });
  }

  blocks.push({ type: 'grayBar', text: 'Response / Actions Taken' });
  blocks.push({ type: 'checkboxGrid', options: RESPONSE_ACTIONS, checked: model.responseActions });
  if ((model.responseActions || []).includes('Other') && model.responseActionsOther) {
    blocks.push({ type: 'textBox', title: 'Other Action', text: model.responseActionsOther });
  }
  blocks.push({ type: 'textBox', title: 'Safety / Supervisor Observations and Actions', text: model.safetyObservations });

  blocks.push({ type: 'grayBar', text: 'Medical Evaluation / Work Status' });
  const evalLabel = optionLabel(MEDICAL_EVALUATION_TYPES, model.medicalEvaluationType)
    || (model.medicalEvaluationType === 'other' ? model.medicalEvaluationOther : '');
  const workStatusLabel = model.workStatus === 'offWork'
    ? `Off Work Until ${fmtDate(model.offWorkUntilDate)}`
    : model.workStatus === 'fullDuty' && model.fullDutyOnDate
      ? `Full Duty on ${fmtDate(model.fullDutyOnDate)}`
      : optionLabel(WORK_STATUS_OPTIONS, model.workStatus);
  blocks.push({ type: 'infoTable', rows: [
    ['Medical Evaluation', evalLabel, 'Clinic / Provider', model.clinicProvider],
  ] });
  blocks.push({ type: 'infoTable', rows: [['Work Status', workStatusLabel]] });

  const attachOptions = (model.attachments || []).includes('Other') && model.attachmentOther
    ? MEDICAL_ATTACHMENT_OPTIONS.map(o => (o === 'Other' ? `Other — ${model.attachmentOther}` : o))
    : MEDICAL_ATTACHMENT_OPTIONS;
  const attachChecked = (model.attachments || [])
    .map(o => (o === 'Other' && model.attachmentOther ? `Other — ${model.attachmentOther}` : o));
  blocks.push({
    type: 'twoCol',
    colA: [
      { type: 'grayBar', text: 'Attachments' },
      { type: 'infoTable', rows: [['Provider Note Attached', model.providerNoteAttached ? 'Yes' : 'No']] },
      { type: 'checkboxGrid', options: attachOptions, checked: attachChecked, columns: 2 },
    ],
    colB: [
      { type: 'grayBar', text: 'Initial Classification' },
      {
        type: 'checkboxGrid',
        options: INITIAL_CLASSIFICATIONS.map(c => c.label),
        checked: optionLabel(INITIAL_CLASSIFICATIONS, model.initialClassification),
        columns: 1,
      },
    ],
  });

  blocks.push({ type: 'grayBar', text: 'Signatures' });
  blocks.push({
    type: 'signatureRow',
    label: 'Employee Signature (if able)',
    nameValue: model.employeeSignatureName || model.employeeName,
    dataUrl: model.employeeSignatureData,
    dateValue: fmtDate(model.employeeSignatureDate),
  });
  blocks.push({
    type: 'signatureRow',
    label: 'Safety / Supervisor Signature',
    nameValue: model.supervisorSignatureName || model.supervisor,
    dataUrl: model.supervisorSignatureData,
    dateValue: fmtDate(model.supervisorSignatureDate),
  });

  return blocks;
}
