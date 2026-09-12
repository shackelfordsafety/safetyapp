/* Click "Download Document" and read the PDF the user would actually get.
 *
 * The four Superintendent forms are drawn into the PDF rather than
 * screenshotted from the DOM, so the hidden export root a suite used to
 * measure is no longer the printed artifact. This is how a suite gets hold
 * of the real one.
 */

import { readFileSync } from 'node:fs';
import { readPdf } from './readPdf.mjs';

export async function downloadGeneratedPdf(page, savePath) {
  const downloadPromise = page.waitForEvent('download');
  // Scoped to .pdfReadyPanel -- some Review screens now show a second,
  // unrelated "Download Document" button elsewhere on the page (e.g. the
  // "What Will Print" facsimile panel), which made an unscoped locator here
  // ambiguous.
  await page.locator('.pdfReadyPanel button', { hasText: 'Download' }).click();
  const download = await downloadPromise;
  await download.saveAs(savePath);
  return {
    pdf: readPdf(readFileSync(savePath)),
    suggestedName: download.suggestedFilename(),
    savedTo: savePath,
  };
}
