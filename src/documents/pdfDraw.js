/* ── Draw-it-directly PDF kit ──────────────────────────────────────────────
   The "stencil kit" for building a Shackelford form straight into a PDF,
   instead of rendering it as a web page and photographing it.

   WHY THIS EXISTS
   The existing pipeline (pdfExportCore.js) renders the form as DOM, screen-
   shots it with html2canvas, and staples the pictures into a PDF. That means
   the finished document is an IMAGE of a form, and whatever the browser did
   while taking the picture is baked in permanently. Every rendering defect
   this project has fought came from that one fact:
     - html2canvas mis-measured the text baseline and painted all text ~8px
       low inside correct boxes;
     - iOS Safari inflated small text in wide blocks before the screenshot,
       so an iPad produced different typography than a laptop;
     - html2canvas ignores object-fit, so a signature stretched to whatever
       box it was given.
   None of those are possible here. We are told exactly how wide and tall a
   piece of text is BEFORE drawing it, so centering is arithmetic rather than
   a calibrated fudge constant, and no browser draws anything.

   COORDINATES
   pdf-lib's origin is the BOTTOM-left corner with y increasing upward, which
   is the opposite of how a form is read and written. Everything in this file
   works in top-down points (y = 0 at the top edge of the page) and converts
   once, in `flip()`, at the moment of drawing. Do not mix the two.

   UNITS
   Points throughout: 72pt = 1 inch. US Letter = 612 x 792pt. The old CSS
   sizes carry over directly because CSS pt and PDF pt are the same unit —
   a 9.5pt gray bar title is still 9.5pt here. */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* Date/time formatting shared by every *PdfDraw.js caller — the model
   stores ISO strings (<input type="date">/"datetime-local"> native format),
   the printed form wants US date style. */
export function fmtDate(v) {
  if (!v) return '';
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

const PT_PER_IN = 72;
export const PAGE_W = 8.5 * PT_PER_IN;
export const PAGE_H = 11 * PT_PER_IN;
const MARGIN = 0.3 * PT_PER_IN;
export const CONTENT_W = PAGE_W - MARGIN * 2;

/* Helvetica is metric-compatible with Arial and is built into every PDF
   reader, so nothing has to be embedded and the file stays small. These are
   the standard AFM metrics per 1000 units. */
const CAP_HEIGHT = 0.718;
const DESCENDER = 0.207;

const INK = rgb(0, 0, 0);
const RULE = rgb(0.6, 0.6, 0.6);
const RULE_DARK = rgb(0.2, 0.2, 0.2);
const GRAY_FILL = rgb(0.851, 0.851, 0.851);
const TINT_FILL = rgb(0.949, 0.949, 0.949);
const LABEL_FILL = rgb(0.937, 0.937, 0.937);
const RED = rgb(0.757, 0.071, 0.122);
const MUTED = rgb(0.2, 0.2, 0.2);

/* Baseline offset from the TOP of a box, such that the text's ink block sits
   optically centered in it. The ink block runs from the cap height above the
   baseline to the descender below it, so centering that block in a box of
   height h puts the baseline at (h + cap - desc) / 2. This is the whole
   reason this rewrite exists: the old pipeline had to guess this number and
   apply it as a hand-tuned constant per element family. */
function centeredBaseline(h, size) {
  return (h + CAP_HEIGHT * size - DESCENDER * size) / 2;
}

/* Baseline offset from the top of a box for TOP-set text (writing boxes),
   leaving `pad` of clear space above the tallest letter. */
function topBaseline(pad, size) {
  return pad + CAP_HEIGHT * size;
}

/* No DRAFT watermark, deliberately (Fonzo, 2026-09-09: "remove the draft
   stamp completely"). It existed to mark a document that had not been
   marked complete -- a state that no longer exists now that finishing a
   document files it. A stamp that says DRAFT on a filed record is worse
   than no stamp at all. */
export async function createFormPdf({ formTitle, logoBytes }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null;

  const pages = [];
  let page = null;
  let y = 0; // top-down cursor
  /* Current drawing column. Full page width normally; narrowed by twoCol(). */
  let colX = MARGIN;
  let colW = CONTENT_W;

  const flip = topY => PAGE_H - topY;
  const widthOf = (text, size, f = font) => f.widthOfTextAtSize(String(text ?? ''), size);

  function drawTextAt(text, x, topBaselineY, size, f = font, color = INK) {
    const str = String(text ?? '');
    if (!str) return;
    page.drawText(str, { x, y: flip(topBaselineY), size, font: f, color });
  }

  function rect(x, topY, w, h, { fill, border, borderWidth = 0.75 } = {}) {
    page.drawRectangle({
      x, y: flip(topY + h), width: w, height: h,
      ...(fill ? { color: fill } : {}),
      ...(border ? { borderColor: border, borderWidth } : {}),
    });
  }

  function line(x1, topY1, x2, topY2, { color = RULE_DARK, thickness = 0.75 } = {}) {
    page.drawLine({ start: { x: x1, y: flip(topY1) }, end: { x: x2, y: flip(topY2) }, color, thickness });
  }

  /* Greedy word wrap. Returns an array of lines that each fit `maxW`. A word
     longer than the line (a pasted URL, an unbroken ID) is hard-split rather
     than allowed to run past the box edge. */
  function wrap(text, maxW, size, f = font) {
    const out = [];
    for (const paragraph of String(text ?? '').split('\n')) {
      if (!paragraph.trim()) { out.push(''); continue; }
      let cur = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (widthOf(next, size, f) <= maxW) { cur = next; continue; }
        if (cur) out.push(cur);
        if (widthOf(word, size, f) <= maxW) { cur = word; continue; }
        let chunk = '';
        for (const ch of word) {
          if (widthOf(chunk + ch, size, f) > maxW) { out.push(chunk); chunk = ch; }
          else chunk += ch;
        }
        cur = chunk;
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [''];
  }

  const HEADER_H = 46;
  function newPage(continuation) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    if (logo) {
      const h = 30;
      const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: MARGIN, y: flip(MARGIN + h), width: w, height: h });
    }
    const titleSize = 12.5;
    const tw = widthOf(formTitle, titleSize, bold);
    drawTextAt(formTitle, PAGE_W / 2 - tw / 2, MARGIN + 20, titleSize, bold);
    if (continuation) {
      const cw = widthOf('CONTINUATION', 8.5, bold);
      drawTextAt('CONTINUATION', PAGE_W / 2 - cw / 2, MARGIN + 32, 8.5, bold, RED);
    }
    /* No page label here — the total isn't knowable while drawing, so
       finish() stamps "Page N of M" onto every page at the end. */
    rect(MARGIN, MARGIN + HEADER_H - 4, CONTENT_W, 2.2, { fill: RED });
    y = MARGIN + HEADER_H + 6;
  }

  const bottomLimit = () => PAGE_H - MARGIN;
  /* Drawable height of a fresh page — how tall a block can be and still be
     keepable whole. */
  const pageCapacity = () => bottomLimit() - (MARGIN + HEADER_H + 6);
  function ensure(h) {
    if (!page) { newPage(false); return; }
    if (y + h > bottomLimit()) newPage(true);
  }

  const api = {
    get cursor() { return y; },
    space(h) { y += h; },

    /* MAJOR section divider. */
    grayBar(text) {
      const size = 9.5;
      const h = 17;
      ensure(h + 4);
      rect(colX, y, colW, h, { fill: GRAY_FILL, border: RULE });
      drawTextAt(String(text).toUpperCase(), colX + 7, y + centeredBaseline(h, size), size, bold);
      y += h;
    },

    /* Numbered subsection caption band — the header OF the box beneath it,
       so it shares that box's border and carries a lighter tint than a major
       gray bar. */
    numberedBar(number, text) {
      const size = 9.5;
      const h = 17;
      ensure(h + 20);
      rect(colX, y, colW, h, { fill: TINT_FILL, border: RULE });
      let x = colX + 7;
      if (number != null) {
        drawTextAt(`${number}.`, x, y + centeredBaseline(h, size), size, bold);
        x += 13;
      }
      drawTextAt(String(text).toUpperCase(), x, y + centeredBaseline(h, size), size, bold);
      y += h;
    },

    /* Subsection label — the bare bold caption above a field. Caps by
       default, matching every other caption in the kit; `caps: false` keeps
       the source form's own sentence where the paper reads as a sentence
       rather than a label ("This notice serves as:"). */
    fieldLabel(text, { caps = true } = {}) {
      const size = 9.5;
      const h = 13;
      ensure(h + 16);
      drawTextAt(caps ? String(text).toUpperCase() : String(text), colX, y + centeredBaseline(h, size), size, bold);
      y += h;
    },

    /* A line of small print — an instruction or a legal note the paper form
       carries. Not a label and not a field: it exists to be READ off the
       printed page, which is why it belongs here and not only in the app's
       on-screen helper text. */
    note(text) {
      const size = 8;
      const lines = wrap(text, colW, size, italic);
      ensure(lines.length * 10 + 4);
      lines.forEach(ln => {
        drawTextAt(ln, colX, y + topBaseline(2, size), size, italic, MUTED);
        y += 10;
      });
      y += 2;
    },

    /* Rows of [label, value] or [label, value, label, value]. `labelW` is a
       fraction of the content width. */
    infoTable(rows, labelW = 0.32) {
      const labelSize = 9.5;
      const valueSize = 10;
      const MIN_ROW_H = 19;
      for (const row of rows) {
        const cellsRaw = row.length === 4
          ? [
            { w: colW * labelW, label: true, text: row[0] },
            { w: colW * (0.5 - labelW), label: false, text: row[1] },
            { w: colW * labelW, label: true, text: row[2] },
            { w: colW * (0.5 - labelW), label: false, text: row[3] },
          ]
          : [
            { w: colW * labelW, label: true, text: row[0] },
            { w: colW * (1 - labelW), label: false, text: row[1] },
          ];
        /* Wrap rather than truncate. An earlier version chopped anything too
           wide to fit, which silently printed "Effective Separation Date" as
           "Effective Separation" — losing words off a signed record is not a
           cosmetic bug. Rows grow to fit their tallest cell instead. */
        const cells = cellsRaw.map(c => {
          const size = c.label ? labelSize : valueSize;
          const f = c.label ? bold : font;
          return { ...c, size, f, lines: wrap(c.text, c.w - 12, size, f) };
        });
        const lead = 11.5;
        const tallest = Math.max(...cells.map(c => c.lines.length));
        const rowH = Math.max(MIN_ROW_H, tallest * lead + 7);
        ensure(rowH);

        let x = colX;
        for (const c of cells) {
          rect(x, y, c.w, rowH, { fill: c.label ? LABEL_FILL : undefined, border: RULE });
          if (c.lines.length === 1) {
            drawTextAt(c.lines[0], x + 6, y + centeredBaseline(rowH, c.size), c.size, c.f);
          } else {
            const blockTop = (rowH - c.lines.length * lead) / 2;
            c.lines.forEach((ln, i) => {
              drawTextAt(ln, x + 6, y + blockTop + topBaseline(0, c.size) + i * lead, c.size, c.f);
            });
          }
          x += c.w;
        }
        y += rowH;
      }
    },

    /* A writing box. Text is TOP-set, like every paper form. Grows to fit
       its content, never below minH, and CONTINUES ONTO THE NEXT PAGE when
       the content is taller than a page.

       That continuation is not a nicety. Sizing the box to all of its text
       and drawing it in one go paints anything past the foot of the page off
       the sheet, where it simply never appears — an incident narrative or a
       timeline losing its ending, with nothing on the page to suggest words
       are missing. Same principle as wrapping instead of truncating: on a
       document somebody signs, silently dropping the user's words is data
       loss. */
    textBox({ title, text, minH = 38 }) {
      const size = 9.7;
      const lead = size * 1.32;
      const padX = 7;
      const padY = 6;
      if (title) this.fieldLabel(title);

      const lines = wrap(text, colW - padX * 2, size);
      const total = Math.max(minH, padY * 2 + lines.length * lead);
      /* Keep the box whole where that's possible: asking for all of it means
         a box that merely doesn't fit the space left moves to the next page
         intact. A box taller than any page can't be kept whole, so it asks
         only for enough room to be worth starting here. */
      ensure(total <= pageCapacity() ? total : padY * 2 + lead * 3);

      let remaining = lines;
      let first = true;
      do {
        const room = bottomLimit() - y;
        const fits = Math.max(1, Math.floor((room - padY * 2) / lead));
        const chunk = remaining.slice(0, fits);
        remaining = remaining.slice(fits);
        /* A box that continues runs to the foot of the page; the last one
           shrinks back to its content. */
        const h = remaining.length
          ? room
          : Math.max(first ? minH : padY * 2 + lead, padY * 2 + chunk.length * lead);
        rect(colX, y, colW, h, { border: RULE });
        let by = y + topBaseline(padY, size);
        for (const ln of chunk) {
          drawTextAt(ln, colX + padX, by, size, font);
          by += lead;
        }
        y += h;
        first = false;
        if (remaining.length) newPage(true);
      } while (remaining.length);
    },

    /* Check-all-that-apply grid. `columns` defaults to 2. */
    checkboxGrid({ options, checked, columns = 2 }) {
      const list = Array.isArray(checked) ? checked : [checked].filter(Boolean);
      const size = 9.5;
      const rowH = 14;
      const box = 8;
      const cellW = colW / columns;
      const rows = Math.ceil(options.length / columns);
      ensure(rows * rowH + 4);
      y += 2;
      options.forEach((opt, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = colX + col * cellW;
        const topY = y + row * rowH;
        const isOn = list.includes(opt);
        const boxTop = topY + (rowH - box) / 2;
        rect(x, boxTop, box, box, { border: RULE_DARK, borderWidth: 0.9 });
        if (isOn) {
          // A drawn tick, not a glyph — no font can decide to render it oddly.
          line(x + 1.6, boxTop + box * 0.55, x + box * 0.42, boxTop + box - 1.6, { color: INK, thickness: 1.1 });
          line(x + box * 0.42, boxTop + box - 1.6, x + box - 1.2, boxTop + 1.4, { color: INK, thickness: 1.1 });
        }
        drawTextAt(opt, x + box + 5, topY + centeredBaseline(rowH, size), size, isOn ? bold : font);
      });
      y += rows * rowH + 2;
    },

    /* One signature + date pair. The slot owns the single signing rule; the
       caption below it draws none. `nameValue` prints a NAME line above the
       signature, the way the paper Medical Event form asks for it. */
    signatureRow({ label: sigLabel, dateLabel = 'Date', image, dateValue, note, nameValue }) {
      const slotH = 40;
      const capSize = 8;
      const capH = 12;
      ensure(slotH + capH + 8 + (nameValue !== undefined ? 18 : 0));
      if (nameValue !== undefined) {
        const nameH = 15;
        drawTextAt('NAME', colX, y + topBaseline(4, capSize), capSize, font, MUTED);
        drawTextAt(String(nameValue || ''), colX + 34, y + topBaseline(3, 10), 10, font);
        line(colX + 30, y + nameH, colX + colW, y + nameH);
        y += nameH + 3;
      }
      y += 6;
      const gap = 12;
      const sigW = colW * 0.64;
      const dateW = colW - sigW - gap;
      const dateX = colX + sigW + gap;

      if (note) {
        const nw = widthOf(note, 7.8, italic);
        drawTextAt(note, colX + sigW / 2 - nw / 2, y + slotH - 6, 7.8, italic, rgb(0.47, 0.47, 0.47));
      } else if (image) {
        // Drawn at the image's own aspect ratio — never stretched to the line.
        const h = Math.min(slotH - 2, image.height);
        const scale = h / image.height;
        const w = Math.min(image.width * scale, sigW - 4);
        const hh = w / image.width * image.height;
        page.drawImage(image, { x: colX + 2, y: flip(y + slotH - 1), width: w, height: hh });
      }
      line(colX, y + slotH, colX + sigW, y + slotH);
      drawTextAt(String(sigLabel).toUpperCase(), colX, y + slotH + topBaseline(3, capSize), capSize, font, MUTED);

      // A note (e.g. "Refused / Unavailable to Sign") replaces the date too —
      // there is no signing date to print. Same guard multiSignatureRow uses.
      if (!note && dateValue) drawTextAt(dateValue, dateX + 2, y + slotH - 4, 10, font);
      line(dateX, y + slotH, colX + colW, y + slotH);
      drawTextAt(String(dateLabel).toUpperCase(), dateX, y + slotH + topBaseline(3, capSize), capSize, font, MUTED);
      y += slotH + capH + 4;
    },

    /* Two independent field groups side by side. Each callback draws with the
       normal stencils — they just run inside a narrower column. Both columns
       start at the same y and the cursor lands at the taller one's bottom, so
       the pair reads as one section instead of two things that happen to be
       near each other. */
    twoCol(left, right, gap = 12) {
      const outerX = colX;
      const outerW = colW;
      const half = (outerW - gap) / 2;
      // Don't start a paired row that can't fit a reasonable amount of it.
      ensure(140);
      const top = y;
      const startPage = page;

      colX = outerX; colW = half;
      left();
      const leftBottom = y;
      const leftEnd = pages.indexOf(page);

      /* Rewind to the page the pair started on, not just to the starting y.
         If the left column ran onto another page, the right column still
         belongs BESIDE the left column's opening — restoring y alone would
         drop it at that same height on whatever page the left column
         happened to finish on, leaving a hole in the middle of the sheet and
         a block of fields floating under content it is supposed to sit
         next to. */
      page = startPage;
      y = top;
      colX = outerX + half + gap; colW = half;
      right();
      const rightBottom = y;
      const rightEnd = pages.indexOf(page);

      colX = outerX; colW = outerW;
      /* Carry on from whichever column finished last — furthest page first,
         then furthest down that page. */
      const lastPage = Math.max(leftEnd, rightEnd);
      page = pages[lastPage];
      if (leftEnd === rightEnd) y = Math.max(leftBottom, rightBottom);
      else y = lastPage === leftEnd ? leftBottom : rightBottom;
    },

    /* N signature blocks across — Separation's Employee / Supervisor / HR row.
       Every column's rule and caption sits on the same line, including a
       column carrying a "refused to sign" note instead of a signature. */
    multiSignatureRow(items) {
      const slotH = 34;
      const capSize = 7.6;
      const gap = 10;
      ensure(slotH + 26);
      y += 6;
      const each = (colW - gap * (items.length - 1)) / items.length;
      items.forEach((it, i) => {
        const x = colX + i * (each + gap);
        if (it.note) {
          const nw = widthOf(it.note, 7.6, italic);
          drawTextAt(it.note, x + each / 2 - nw / 2, y + slotH - 5, 7.6, italic, rgb(0.47, 0.47, 0.47));
        } else if (it.image) {
          const h = Math.min(slotH - 2, it.image.height);
          const s = h / it.image.height;
          const w = Math.min(it.image.width * s, each - 4);
          const hh = w / it.image.width * it.image.height;
          page.drawImage(it.image, { x: x + 2, y: flip(y + slotH - 1), width: w, height: hh });
        }
        line(x, y + slotH, x + each, y + slotH);
        drawTextAt(String(it.label).toUpperCase(), x, y + slotH + topBaseline(3, capSize), capSize, font, MUTED);
        if (!it.note && it.dateValue) {
          drawTextAt(it.dateValue, x, y + slotH + topBaseline(3, capSize) + 11, capSize, font, rgb(0.33, 0.33, 0.33));
        }
      });
      y += slotH + 26;
    },

    async embedSignature(dataUrl) {
      if (!dataUrl || typeof dataUrl !== 'string') return null;
      try {
        const base64 = dataUrl.split(',')[1] || '';
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return dataUrl.includes('image/jpeg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      } catch { return null; }
    },

    /* Stamps "Page N of M" onto every page once the document is complete —
       the total isn't knowable while the pages are being drawn, which is why
       newPage() deliberately leaves this corner empty. */
    async finish() {
      const total = pages.length;
      pages.forEach((p, i) => {
        const label = `Page ${i + 1} of ${total}`;
        p.drawText(label, {
          x: PAGE_W - MARGIN - widthOf(label, 8.5),
          y: PAGE_H - (MARGIN + 16), size: 8.5, font, color: MUTED,
        });
      });
      const bytes = await pdf.save();
      return { blob: new Blob([bytes], { type: 'application/pdf' }), pageCount: total };
    },
  };

  newPage(false);
  return api;
}

/* The logo ships as .webp, which PDFs cannot embed. Decode it once through a
   canvas and hand back PNG bytes. */
export async function loadLogoPngBytes(url) {
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return null; }
}
