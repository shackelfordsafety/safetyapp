import { useEffect } from 'react';
import { IS_DEMO } from './demoMode';
import './demoBanner.css';

/* ── "You are on the practice one" ───────────────────────────────────────
   The testing site is a pixel-for-pixel copy of the real one, which is
   exactly the problem when somebody who has never seen either is sat in
   front of it. This has to be impossible to miss and impossible to
   dismiss -- there is no close button on purpose. Somebody who hides it,
   files a document twenty minutes later and believes it went somewhere is
   the whole failure this is here to prevent.

   Deliberately says what still works, not just what doesn't. An owner
   being shown the app should be building JSAs and printing them with
   confidence; the only thing missing is that nothing leaves the device. */

export default function DemoBanner() {
  /* The tab title too. Somebody demoing will end up with the real site and
     this one open side by side, and two identical tabs is how a document
     gets filed from the wrong one. */
  useEffect(() => {
    if (!IS_DEMO) return;
    if (!document.title.startsWith('TESTING')) document.title = `TESTING — ${document.title}`;
  }, []);

  if (!IS_DEMO) return null;
  return (
    <div className="demoBanner" role="status">
      <span className="demoBannerTag">Testing site</span>
      <span className="demoBannerText">
        Practice copy — build, print and try anything you like.
        Nothing here is filed, published, or sent to a real crew.
      </span>
    </div>
  );
}
