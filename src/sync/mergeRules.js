/* ── How two devices' templates become one list ──────────────────────────
   Pure functions, no network, no storage, nothing imported. That is
   deliberate: this is the part where data actually gets lost, so it has to
   be testable on its own without a database or a browser
   (tools/testing/verify-sync-merge.mjs).

   Kept out of syncMeta.js because that one IS imported eagerly by the app,
   and these rules are only ever needed by the lazily loaded sync code. */

/* Tombstones are kept for a season and then forgotten. Long enough that an
   iPad which has been in a truck for a month still learns about a
   deletion; short enough that the list cannot grow forever. */
export const TOMBSTONE_TTL_DAYS = 120;

function stamp(t) {
  return Date.parse(t?.updatedAt || t?.createdAt || 0) || 0;
}

export function mergeTombstones(a, b) {
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  const byId = new Map();
  [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach((t) => {
    if (!t?.id) return;
    const at = Date.parse(t.at || 0) || 0;
    if (at < cutoff) return;
    const prev = byId.get(t.id);
    if (!prev || at > (Date.parse(prev.at) || 0)) byId.set(t.id, { id: t.id, at: t.at });
  });
  return [...byId.values()];
}

/* Per-template, newest edit wins -- NOT last-write-wins on the whole list.
   The difference matters: whole-list wins would mean a template made on
   the phone this morning vanishes the moment the iPad, which never saw it,
   saves anything at all. Merging by id means both survive.

   A template is dropped only when a tombstone for it is NEWER than the
   template itself, so deleting on one device and then editing on another
   keeps the edit rather than silently discarding somebody's work. */
export function mergeTemplates(local, cloud, tombstones) {
  const byId = new Map();
  [...(Array.isArray(local) ? local : []), ...(Array.isArray(cloud) ? cloud : [])].forEach((t) => {
    if (!t?.id) return;
    const prev = byId.get(t.id);
    if (!prev || stamp(t) > stamp(prev)) byId.set(t.id, t);
  });

  (Array.isArray(tombstones) ? tombstones : []).forEach((tomb) => {
    const t = byId.get(tomb?.id);
    if (!t) return;
    if ((Date.parse(tomb.at) || 0) >= stamp(t)) byId.delete(tomb.id);
  });

  // Newest first, and deterministic, so the Templates screen does not
  // reshuffle itself every time a sync lands.
  return [...byId.values()].sort((x, y) => stamp(y) - stamp(x));
}
