/* Uncontrolled Event Report, drawn straight into the PDF. See pdfDraw.js. */

import { createFormPdf, loadLogoPngBytes, fmtDate, fmtDateTime } from '../pdfDraw';
import {
  EVENT_CLASSIFICATIONS, EVENT_OUTCOMES, NOTIFICATION_OPTIONS, ATTACHMENT_OPTIONS,
  
} from './uncontrolledEventModel';

const FORM_TITLE = 'UNCONTROLLED EVENT REPORT';

export async function drawUncontrolledEventPdf(model, onProgress) {
  onProgress?.(1, 1);
  const logoBytes = await loadLogoPngBytes(`${import.meta.env.BASE_URL}icons/shackelford-logo.webp`);
  const doc = await createFormPdf({
    formTitle: FORM_TITLE,
    logoBytes,  });

  doc.infoTable([
    ['Workplace Location / Project', model.workplaceLocation],
    ['Date of Event', fmtDate(model.eventDate)],
    ['Weather / Conditions', model.weatherConditions],
    ['Report Written', fmtDateTime(model.reportWrittenDateTime)],
    ['Reported to Supervisor', fmtDateTime(model.reportedToSupervisorDateTime)],
  ], 0.34);

  doc.space(6);
  doc.twoCol(
    () => {
      doc.grayBar('Event Classification');
      doc.checkboxGrid({ options: EVENT_CLASSIFICATIONS, checked: model.eventClassifications, columns: 1 });
      if ((model.eventClassifications || []).includes('Other') && model.eventClassificationOther) {
        doc.space(4);
        doc.textBox({ title: 'Other Classification', text: model.eventClassificationOther, minH: 20 });
      }
    },
    () => {
      doc.grayBar('Outcome / Impact');
      doc.checkboxGrid({ options: EVENT_OUTCOMES, checked: model.eventOutcomes, columns: 1 });
      if ((model.eventOutcomes || []).includes('Other') && model.eventOutcomeOther) {
        doc.space(4);
        doc.textBox({ title: 'Other Outcome', text: model.eventOutcomeOther, minH: 20 });
      }
      if (model.estimatedCost) {
        doc.space(4);
        doc.textBox({ title: 'Estimated Cost', text: model.estimatedCost, minH: 20 });
      }
    },
  );

  doc.space(6);
  doc.textBox({
    title: 'What Happened / Brief Summary / Timeline',
    text: model.whatHappened,
    minH: 62,
  });

  doc.space(6);
  doc.twoCol(
    () => {
      doc.textBox({ title: 'Immediate Actions Taken', text: model.immediateActionsTaken, minH: 48 });
      doc.space(5);
      doc.textBox({ title: 'Witnesses', text: model.witnesses, minH: 30 });
    },
    () => {
      doc.grayBar('Notifications / Attachments');
      doc.checkboxGrid({ options: NOTIFICATION_OPTIONS, checked: model.notifications, columns: 2 });
      doc.checkboxGrid({ options: ATTACHMENT_OPTIONS, checked: model.attachments, columns: 2 });
      if ((model.attachments || []).includes('Other') && model.attachmentOther) {
        doc.space(4);
        doc.textBox({ title: 'Other Attachment', text: model.attachmentOther, minH: 18 });
      }
    },
  );

  doc.space(6);
  doc.grayBar('Reported By / Supervisor Review');
  doc.infoTable([
    ['Reported By — Name', model.reportedByName],
    ['Reported By — Title', model.reportedByTitle],
    ['Supervisor Reviewing', model.supervisorReviewName],
  ], 0.34);

  doc.signatureRow({
    label: 'Reported By Signature',
    image: await doc.embedSignature(model.reportedBySignatureData),
    dateValue: fmtDate(model.reportedBySignatureDate),
  });
  doc.signatureRow({
    label: 'Supervisor Signature',
    image: await doc.embedSignature(model.supervisorSignatureData),
    dateValue: fmtDate(model.supervisorSignatureDate),
  });

  return doc.finish();
}

/* Review-screen facsimile — mirrors drawUncontrolledEventPdf's call
   sequence above block-for-block (see DocFacsimile in FormPrimitives.jsx).
   Keep these two in sync: a field added to one belongs in the other. */
export function uncontrolledEventFacsimileBlocks(model) {
  const blocks = [];
  blocks.push({ type: 'infoTable', rows: [
    ['Workplace Location / Project', model.workplaceLocation],
    ['Date of Event', fmtDate(model.eventDate)],
    ['Weather / Conditions', model.weatherConditions],
    ['Report Written', fmtDateTime(model.reportWrittenDateTime)],
    ['Reported to Supervisor', fmtDateTime(model.reportedToSupervisorDateTime)],
  ] });

  const colA = [
    { type: 'grayBar', text: 'Event Classification' },
    { type: 'checkboxGrid', options: EVENT_CLASSIFICATIONS, checked: model.eventClassifications, columns: 1 },
  ];
  if ((model.eventClassifications || []).includes('Other') && model.eventClassificationOther) {
    colA.push({ type: 'textBox', title: 'Other Classification', text: model.eventClassificationOther });
  }
  const colB = [
    { type: 'grayBar', text: 'Outcome / Impact' },
    { type: 'checkboxGrid', options: EVENT_OUTCOMES, checked: model.eventOutcomes, columns: 1 },
  ];
  if ((model.eventOutcomes || []).includes('Other') && model.eventOutcomeOther) {
    colB.push({ type: 'textBox', title: 'Other Outcome', text: model.eventOutcomeOther });
  }
  if (model.estimatedCost) colB.push({ type: 'textBox', title: 'Estimated Cost', text: model.estimatedCost });
  blocks.push({ type: 'twoCol', colA, colB });

  blocks.push({ type: 'textBox', title: 'What Happened / Brief Summary / Timeline', text: model.whatHappened });

  const colA2 = [
    { type: 'textBox', title: 'Immediate Actions Taken', text: model.immediateActionsTaken },
    { type: 'textBox', title: 'Witnesses', text: model.witnesses },
  ];
  const colB2 = [
    { type: 'grayBar', text: 'Notifications / Attachments' },
    { type: 'checkboxGrid', options: NOTIFICATION_OPTIONS, checked: model.notifications, columns: 2 },
    { type: 'checkboxGrid', options: ATTACHMENT_OPTIONS, checked: model.attachments, columns: 2 },
  ];
  if ((model.attachments || []).includes('Other') && model.attachmentOther) {
    colB2.push({ type: 'textBox', title: 'Other Attachment', text: model.attachmentOther });
  }
  blocks.push({ type: 'twoCol', colA: colA2, colB: colB2 });

  blocks.push({ type: 'grayBar', text: 'Reported By / Supervisor Review' });
  blocks.push({ type: 'infoTable', rows: [
    ['Reported By — Name', model.reportedByName],
    ['Reported By — Title', model.reportedByTitle],
    ['Supervisor Reviewing', model.supervisorReviewName],
  ] });

  blocks.push({ type: 'signatureRow', label: 'Reported By Signature', dataUrl: model.reportedBySignatureData, dateValue: fmtDate(model.reportedBySignatureDate) });
  blocks.push({ type: 'signatureRow', label: 'Supervisor Signature', dataUrl: model.supervisorSignatureData, dateValue: fmtDate(model.supervisorSignatureDate) });

  return blocks;
}
