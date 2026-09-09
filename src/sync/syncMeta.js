/* ── The bookkeeping half of sync, with no cloud in it ───────────────────
   Split out from userSync.js on purpose. The app itself has to record a
   template deletion and a settings edit the moment they happen, and those
   calls live in main.jsx -- so if they came from the module that imports
   the Supabase client, the whole auth and network library would land in
   the bundle every superintendent downloads, offline or not.

   Everything here is localStorage only. It is safe to import eagerly. */

const TOMBSTONE_KEY = 'sdc.jsa.templates.tombstones.v1';
const META_KEY = 'sdc.sync.meta.v1';

export function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
export function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function readTombstones() {
  const raw = readJson(TOMBSTONE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}
export function writeTombstones(list) {
  writeJson(TOMBSTONE_KEY, list);
}

/* Called when a template is deleted, so the deletion can travel. Without
   this, merging would only ever union two lists, and a template deleted
   on the iPad would come back from the phone the next time they met --
   and again, and again, forever. */
export function recordTemplateDeletion(id) {
  if (!id) return;
  const list = readTombstones().filter(t => t?.id !== id);
  list.push({ id, at: new Date().toISOString() });
  writeTombstones(list);
}

/* Settings go newest-wins as a whole object, so the local edit time has
   to be recorded somewhere. It lives here rather than inside the settings
   blob so the stored shape stays exactly what it has always been -- an
   older device, or a version of this app from before sync, keeps reading
   it without noticing anything changed. */
export function markSettingsChanged() {
  writeJson(META_KEY, { ...readJson(META_KEY, {}), settingsUpdatedAt: new Date().toISOString() });
}

export function localSettingsStamp() {
  return Date.parse(readJson(META_KEY, {})?.settingsUpdatedAt || 0) || 0;
}
