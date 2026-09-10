/* ── The testing site is a sandbox, not a second front door ──────────────
   The `testing` branch is mirrored at a Cloudflare preview URL, and it
   runs the SAME code against the SAME database as the live site. That was
   fine while Fonzo was the only person who ever opened it. It stops being
   fine the moment the owners are sat in front of it being told to "mess
   around" -- a JSA published there would appear on a real board a real
   crew scans, and a filed document would land in the real archive, which
   by design has no delete.

   So on the preview host, every write to the cloud is refused at the
   source. Not hidden behind a disabled button -- refused in the one place
   every write has to pass through, so a screen I forget to update cannot
   quietly let something out.

   Everything that does NOT leave the device still works completely:
   building all six document types, drafts, templates, page fit, real PDF
   generation, printing. That is the whole demo, and it is the part worth
   showing an owner anyway.

   Detected from the hostname rather than a build flag, deliberately: the
   deployment configuration is not something to change for this, and a
   hostname cannot drift out of sync with which branch got built. The
   live GitHub Pages site can never match, so this can never fire there.

   ?demo=1 forces it on anywhere, for walking somebody through the app on
   a laptop without touching real records. */

const DEMO_HOST_PATTERNS = [/\.workers\.dev$/i, /\.pages\.dev$/i];

export const IS_DEMO = (() => {
  try {
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('demo') === '1') return true;
    return DEMO_HOST_PATTERNS.some(re => re.test(window.location.hostname));
  } catch {
    return false;
  }
})();

/* Named so a caller can tell "we refused this on purpose" apart from a
   real network failure, and say so in words a person understands rather
   than showing a connection error for something that was never sent. */
export class DemoBlockedError extends Error {
  constructor(action = 'That') {
    super(`${action} is switched off on the testing site — nothing here is saved or sent anywhere real.`);
    this.name = 'DemoBlockedError';
  }
}

export function blockInDemo(action) {
  if (IS_DEMO) throw new DemoBlockedError(action);
}
