/* The PDF machinery, fetched only when somebody actually makes a PDF.

   Why this file exists: html2canvas and pdf-lib together are the single
   biggest thing in the download, and every crew member who opens the app
   on a phone at a job site was pulling all of it just to read a JSA and
   sign it -- on the worst signal any of our users have. Most people who
   open this app never generate a PDF at all.

   Nothing about how PDFs are made changes. These are the same libraries,
   the same versions, doing the same work; they just arrive when the
   button is pressed instead of when the app opens. The first export after
   a fresh load pays a moment to fetch them, and the browser caches them
   from then on.

   Every caller is already an async function, which is why this is a small
   change rather than a rewrite. Keep it that way: if you ever need one of
   these at the top level of a module, that module lands back in the main
   download and this whole file stops paying for itself. */

let cached = null;

export function loadPdfLibs() {
  /* One in-flight promise, shared. Tapping export twice must not fetch
     the libraries twice. */
  if (!cached) {
    cached = Promise.all([
      import('html2canvas'),
      import('pdf-lib'),
    ]).then(([h2c, pdfLib]) => ({
      html2canvas: h2c.default,
      PDFDocument: pdfLib.PDFDocument,
      StandardFonts: pdfLib.StandardFonts,
      rgb: pdfLib.rgb,
    })).catch(err => {
      /* Let the next attempt try again rather than caching the failure --
         this is a field app and the usual cause is signal, not a bug. */
      cached = null;
      throw err;
    });
  }
  return cached;
}
