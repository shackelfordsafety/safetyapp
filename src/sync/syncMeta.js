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
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* private mode, or full */ }
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

/* Put the local settings clock to a specific time -- used when this device
   TAKES the cloud's settings, so it holds the cloud's stamp rather than
   claiming it made the change itself just now. 0 clears it. */
export function setLocalSettingsStamp(ms) {
  const meta = readJson(META_KEY, {});
  const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  writeJson(META_KEY, { ...base, settingsUpdatedAt: ms ? new Date(ms).toISOString() : null });
}

/* ── Whose templates this device is holding ──────────────────────────────
   Templates and settings belong to the device (clearOnSignOut.js leaves
   them on purpose), but the sync row belongs to an account. This is the
   user id whose account this device's copy was last synced with, written
   only after a sync succeeds. Deliberately NOT one of the keys sign-out
   clears: the whole point is to still know, when the next person signs
   in, that what is on the iPad is the previous person's. See planSync()
   in mergeRules.js. */
const OWNER_KEY = 'sdc.sync.owner.v1';

export function readSyncOwner() {
  const v = readJson(OWNER_KEY, null);
  return typeof v === 'string' && v ? v : null;
}
export function writeSyncOwner(uid) {
  if (uid) writeJson(OWNER_KEY, uid);
}

/* ── Set aside, not thrown away ───────────────────────────────────────────
   When somebody else signs in, the previous person's templates and
   settings come off the screen -- but they may include a template made
   offline that never reached the cloud, and deleting it would be losing
   somebody's work. So it is parked here, keyed by that person's id, out of
   sight, and folded back into THEIR account the next time THEY sign in on
   this device. Never shown to, or synced into, anybody else's account.

   Bounded: entries older than the tombstone window, and anything past the
   ten most recent people, are dropped. */
const STASH_KEY = 'sdc.sync.stash.v1';
const STASH_TTL_MS = 120 * 86400000;
const STASH_MAX = 10;

function readStashMap() {
  const raw = readJson(STASH_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function readStashFor(uid) {
  if (!uid) return null;
  const entry = readStashMap()[uid];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
}

export function writeStashFor(uid, entry) {
  if (!uid || !entry) return;
  const cutoff = Date.now() - STASH_TTL_MS;
  const kept = Object.entries({ ...readStashMap(), [uid]: { ...entry, at: new Date().toISOString() } })
    .filter(([, e]) => (Date.parse(e?.at || 0) || 0) >= cutoff)
    .sort(([, a], [, b]) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, STASH_MAX);
  writeJson(STASH_KEY, Object.fromEntries(kept));
}

export function clearStashFor(uid) {
  if (!uid) return;
  const map = readStashMap();
  if (!(uid in map)) return;
  delete map[uid];
  writeJson(STASH_KEY, map);
}

/* The device's own copies of the templates and settings, written directly
   when somebody else's account takes the device over -- so that by the
   time the new owner is recorded, storage already holds THEIR copy, and a
   page closed a moment later cannot leave the previous person's templates
   sitting under the new person's name. Same keys and same shapes main.jsx
   uses (KEYS.templates / KEYS.settings); nothing about them changes. */
const TEMPLATES_KEY = 'sdc.jsa.templates.v1';
const SETTINGS_KEY = 'sdc.settings.v2';

export function writeLocalTemplates(list) {
  return writeJson(TEMPLATES_KEY, Array.isArray(list) ? list : []);
}

/* Written as the exact string main.jsx will compare against, so its
   settings effect sees "nothing changed" and does not stamp this as a
   local edit made just now -- which would make a device that merely
   RECEIVED settings claim to be the newest on its next sync. */
export function writeLocalSettings(settings) {
  return writeJson(SETTINGS_KEY, settings);
}
