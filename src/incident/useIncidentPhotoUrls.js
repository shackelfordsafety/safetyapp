import { useEffect, useRef, useState } from 'react';
import { getPhotoBlob, onPhotoBlobsChanged } from './incidentPhotoStorage';

/* Loads each photo's blob from IndexedDB (see incidentPhotoStorage.js) and
   turns it into an object URL for display -- used both by the on-screen
   Photos step (thumbnails) and by the PDF export root (appendix images), so
   there is exactly one place that owns this lifecycle.

   Returns a plain object keyed by photo id: { [id]: { url, status } },
   status one of 'loading' | 'ready' | 'missing' | 'error'. Callers render a
   placeholder for anything other than 'ready' instead of ever pointing an
   <img> at a URL that isn't actually live yet -- there is no error boundary
   anywhere in this app, so a broken/loading image must never crash or
   silently show a broken-image icon in a generated PDF.

   Object URLs are revoked (a) the moment a photo id disappears from the
   incident's photos array (removed by the user) and (b) on unmount --
   nothing here is ever left dangling across renders. */
export function useIncidentPhotoUrls(photos) {
  const entriesRef = useRef({});
  const [, forceRender] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const photoIds = (photos || []).map(p => p.id).join(',');

  /* A blob that arrives later (a picked-up report's photos fetched back from
     storage) -- forget entries that were missing/errored so the effect
     below reads them again. */
  useEffect(() => onPhotoBlobsChanged(() => {
    let dropped = false;
    Object.keys(entriesRef.current).forEach((id) => {
      const st = entriesRef.current[id]?.status;
      if (st === 'missing' || st === 'error') { delete entriesRef.current[id]; dropped = true; }
    });
    if (dropped) setRetryTick((n) => n + 1);
  }), []);

  useEffect(() => {
    /* No per-run "cancelled" flag: a second photo arriving while the first
       is still being read from IndexedDB used to cancel the first read,
       and because its entry already existed the next run skipped it -- so
       it sat on "Loading photo..." for good, and that text printed in the
       PDF. A late result is simply ignored if the photo has since been
       removed (its entry is gone) or already resolved. */
    const ids = new Set((photos || []).map(p => p.id));
    let changed = false;

    Object.keys(entriesRef.current).forEach((id) => {
      if (!ids.has(id)) {
        const entry = entriesRef.current[id];
        if (entry.url) URL.revokeObjectURL(entry.url);
        delete entriesRef.current[id];
        changed = true;
      }
    });

    (photos || []).forEach((p) => {
      if (entriesRef.current[p.id]) return;
      entriesRef.current[p.id] = { url: null, status: 'loading' };
      changed = true;
      getPhotoBlob(p.id)
        .then((blob) => {
          const cur = entriesRef.current[p.id];
          if (!cur || cur.status !== 'loading') { return; }
          entriesRef.current[p.id] = blob
            ? { url: URL.createObjectURL(blob), status: 'ready' }
            : { url: null, status: 'missing' };
          forceRender((n) => n + 1);
        })
        .catch(() => {
          const cur = entriesRef.current[p.id];
          if (!cur || cur.status !== 'loading') return;
          entriesRef.current[p.id] = { url: null, status: 'error' };
          forceRender((n) => n + 1);
        });
    });

    if (changed) forceRender((n) => n + 1);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIds, retryTick]);

  useEffect(() => () => {
    Object.values(entriesRef.current).forEach((entry) => { if (entry.url) URL.revokeObjectURL(entry.url); });
    entriesRef.current = {};
  }, []);

  return entriesRef.current;
}
