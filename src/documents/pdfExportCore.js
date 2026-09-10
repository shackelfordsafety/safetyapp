import { PDFDocument } from 'pdf-lib';
import html2canvas from 'html2canvas';

/* ── Generic client-side PDF capture/share/download ──
   Same approach JSA's generateJsaPdf and Incident's generateIncidentPdf
   each already use (html2canvas capture of already-rendered US-Letter DOM
   pages, one at a time, assembled with pdf-lib) — extracted here as the
   ONE shared implementation for the four new documents added in this
   mission, instead of writing a third/fourth/fifth near-identical copy of
   this ~60-line loop. JSA and Incident keep their own existing copies
   untouched (see main.jsx / incidentPdfGenerate.jsx) — not worth the
   regression risk of retrofitting stable, already-shipped export code onto
   a shared helper written after the fact.

   pageRefsRef.current must be an array of { type, el } — `type` is used
   only for error messages. */

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function capturePagesToPdf(pageRefsRef, onProgress) {
  const pages = pageRefsRef.current;
  if (!pages.length) throw new Error('No pages to export — the document plan is empty.');

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

  /* html2canvas 1.4.1's FontMetrics probe appends its measuring container
     directly to document.body WITHOUT resetting line-height, so it inherits
     the app shell's `body { line-height: 1.5 }` and reports a baseline
     inflated by the extra half-leading (~7px at this document family's
     10pt/9.5pt sizes). Every glyph then paints that far BELOW its true
     baseline in the raster — confirmed 2026-08-11 by extracting the real
     embedded PDF raster and comparing against a same-page DOM screenshot:
     all text ~8px low; borders, checkbox squares and signature images
     unaffected. Neutralizing body line-height for the duration of the
     capture fixes the probe at the source. JSA/Incident keep their own
     capture code and their own approved, separately-calibrated
     compensations — do NOT apply this to their pipelines without
     re-calibrating those.

     This function itself is no longer exercised by any of the four
     Superintendent documents — they draw their PDFs directly now (see
     pdfDraw.js) and pass renderPdf to usePdfExport, which bypasses this
     entirely. It remains as usePdfExport's fallback capture path for any
     future document that doesn't pass renderPdf. */
  const bodyInlineLineHeight = document.body.style.lineHeight;
  document.body.style.lineHeight = 'normal';
  try {
  for (let i = 0; i < pages.length; i += 1) {
    const { type, el } = pages[i];
    onProgress?.(i + 1, pages.length);

    /* Yield between pages so the UI stays alive -- see the matching note
       in generateJsaPdf (main.jsx), where this was measured. Same fix
       here, because this is the capture path any future document type
       falls back to and the freeze would come with it. */
    if (i > 0) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    if (!el) throw new Error(`Page ${i + 1} of ${pages.length} (${type}) did not render — export aborted.`);

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error(`Page ${i + 1} of ${pages.length} (${type}) has no measurable size — export aborted.`);
    }

    let canvas;
    try {
      canvas = await html2canvas(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
    } catch (err) {
      throw new Error(`Failed to render page ${i + 1} of ${pages.length} (${type}): ${err?.message || err}`);
    }
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error(`Page ${i + 1} of ${pages.length} (${type}) captured empty — export aborted.`);
    }

    const pngBytes = dataUrlToUint8Array(canvas.toDataURL('image/png'));
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const pdfPage = pdfDoc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: LETTER_WIDTH_PT, height: LETTER_HEIGHT_PT });

    canvas.width = 0;
    canvas.height = 0;
    canvas = null;
  }
  } finally {
    document.body.style.lineHeight = bodyInlineLineHeight;
  }

  const pdfBytes = await pdfDoc.save();

  const verifyDoc = await PDFDocument.load(pdfBytes);
  const pageCount = verifyDoc.getPageCount();
  if (pageCount !== pages.length) {
    throw new Error(`Generated PDF has ${pageCount} pages but the plan has ${pages.length} — export aborted.`);
  }

  return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), pageCount };
}

/* Identical contract/behavior to main.jsx's shareGeneratedPdf — see that
   function's own comment for why this must be called with no awaited work
   beforehand (transient user activation). */
export function shareGeneratedPdf(file) {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return { ok: false, reason: 'Sharing is not supported on this browser — use Download PDF instead.' };
  }
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    return { ok: false, reason: 'Sharing this file is not supported on this browser — use Download PDF instead.' };
  }
  const sharePromise = navigator.share({ files: [file], title: file.name });
  return { ok: true, promise: sharePromise };
}

export function downloadGeneratedPdf(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
