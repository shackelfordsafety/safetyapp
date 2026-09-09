import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './boardqr.css';

const LOGO = `${import.meta.env.BASE_URL}icons/shackelford-logo.webp`;

/* ── The QR code for a superintendent's board ────────────────────────────
   Printed once and stuck on the trailer door, where it stays forever. The
   code is built from the account itself, so it cannot expire, cannot point
   at yesterday's JSA, and never needs reprinting when the work changes --
   what sits behind it changes, the sticker never does.

   That permanence is the whole reason the QR points at a BOARD and not at
   a JSA. A per-meeting code, which is what the rest of this industry
   generates, would mean a new printout every morning.

   Generated on the device, not fetched: this app has to work with no
   signal, and a QR pulled from some image service would be a blank square
   in a job trailer. It rides in the lazy board chunk, so a device that
   only builds JSAs never downloads it.

   Lost the sticker? This screen IS the fallback -- hold the iPad up and
   let the crew scan it off the glass, print a replacement whenever. */

export default function BoardQr({ url, label }) {
  const [png, setPng] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!url) return undefined;
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        /* Level M correction: a code on a trailer door gets dust, sun and a
           corner peeled off it, and M recovers from roughly 15% damage
           without making the pattern noticeably denser. */
        const dataUrl = await QRCode.toDataURL(url, {
          width: 900,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#171719', light: '#FFFFFF' },
        });
        if (alive) setPng(dataUrl);
      } catch (ex) {
        if (alive) setError(ex?.message || 'Could not draw the code.');
      }
    })();
    return () => { alive = false; };
  }, [url]);

  /* Printing swaps the whole page for the sheet below, rather than opening
     a popup that a browser may block. The class is removed as soon as the
     dialog closes -- see boardqr.css for why this cannot disturb the JSA
     print system. */
  function printIt() {
    document.body.classList.add('printingQr');
    const cleanup = () => {
      document.body.classList.remove('printingQr');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    // Safari has historically not fired afterprint reliably; belt and braces.
    window.setTimeout(cleanup, 3000);
  }

  return (
    <div className="brdQr">
      <div className="brdQrTop">
        <div>
          <span className="brdSectionTitle">Your QR code</span>
          <p className="helperText">
            Print it once and stick it on the trailer. It never changes and never expires —
            what&apos;s behind it changes, the sticker doesn&apos;t. Lost it? Hold this screen
            up and let them scan it off the iPad.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={printIt} disabled={!png}>
          Print it
        </button>
      </div>

      {error && <p className="archiveError">{error}</p>}
      {!png && !error && <p className="helperText">Drawing the code…</p>}
      {png && <img className="brdQrImg" src={png} alt="QR code for this board" />}

      {/* Portalled to <body> on purpose. The print rule hides every direct
          child of body except this sheet, which only works if the sheet IS
          a direct child -- nested inside the app it would be hidden along
          with its own ancestors. */}
      {png && createPortal(
        <div className="brdQrSheet" aria-hidden="true">
          {/* The logo sits on black because its second line is white type
              on transparent -- on white paper that line simply vanishes.
              Same reason the crew page carries a black brand bar. */}
          <div className="brdQrSheetHead">
            <img className="brdQrSheetLogo" src={LOGO} alt="" />
          </div>
          <div className="brdQrSheetRule" />

          <strong className="brdQrSheetTitle">Scan to sign in</strong>
          <span className="brdQrSheetSub">Job Safety Analysis</span>

          <img className="brdQrSheetCode" src={png} alt="" />

          <span className="brdQrSheetBoard">{label}</span>
          <span className="brdQrSheetHow">
            Point your phone camera at the code. No app, no password.
          </span>

          <div className="brdQrSheetFoot">
            Shackelford Construction and Hauling, LLC
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
