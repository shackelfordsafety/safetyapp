/* ── Loading a lazy module across a deploy ───────────────────────────────
   Every cloud feature in this app arrives through a dynamic import() so
   none of it lands in the bundle a superintendent downloads. The cost of
   that is a real failure mode on a site that redeploys: a tab opened
   before a deploy is running JS that asks for chunk files by their old
   hashed names, and those names no longer exist. The browser reports it as
   "error loading dynamically imported module" / "importing a module script
   failed" -- which reads like the feature is broken when the app is simply
   out of date.

   Hit in the field 2026-09-09 tapping "Publish to my board".

   Reloading is the actual fix, and it is safe here: the document is
   autosaved to this device before any of these buttons can be pressed, and
   these calls only happen on an explicit tap, never mid-typing. Guarded by
   a sessionStorage flag so a genuinely broken deploy shows a real error
   instead of reloading forever. */

const RELOAD_FLAG = 'sdc.chunkReload.v1';

function looksLikeStaleChunk(err) {
  const msg = String(err?.message || err || '');
  return /dynamically imported module|module script failed|Importing a module|Failed to fetch/i.test(msg);
}

export async function loadModule(importer) {
  try {
    const mod = await importer();
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* private mode */ }
    return mod;
  } catch (err) {
    if (!looksLikeStaleChunk(err)) throw err;

    let alreadyTried = false;
    try { alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* private mode */ }
    if (alreadyTried) {
      throw new Error('This part of the app could not load. Check your connection, then close the tab and open it again.');
    }
    try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* private mode */ }
    window.location.reload();
    // Reloading is not instant; keep the caller in its "working" state
    // rather than flashing an error on the way out.
    await new Promise(() => {});
    return null;
  }
}
