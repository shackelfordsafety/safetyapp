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

/* ── Settings' own clock ─────────────────────────────────────────────────
   Settings go newest-wins as a whole object. They used to be compared
   against the sync row's `updated_at` -- but ANY write bumps that (saving
   a template, publishing a JSA), so a month-old theme change on the iPad
   could beat yesterday's edit on the phone just because the iPad saved a
   template afterwards. Audit 2026-09-30.

   There is no column for it and no migration to add one, so the stamp
   rides INSIDE the settings jsonb under a name nothing else uses, and is
   peeled off again on the way down. It never reaches sdc.settings.v2 --
   that stored shape stays exactly what it has always been. Rows written
   before this change have no stamp; for those the old row-wide
   `updated_at` is still the answer, which is exactly today's behaviour. */
export const SETTINGS_STAMP_FIELD = '_settingsUpdatedAt';

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/* { settings, stamp }: the settings with the stamp removed, and the stamp
   in ms -- or null when the row predates the dedicated stamp. */
export function splitCloudSettings(raw) {
  if (!isPlainObject(raw)) return { settings: {}, stamp: null };
  const { [SETTINGS_STAMP_FIELD]: at, ...settings } = raw;
  return { settings, stamp: typeof at === 'string' ? (Date.parse(at) || 0) : null };
}

export function stripSettingsStamp(settings) {
  return splitCloudSettings(settings).settings;
}

export function withSettingsStamp(settings, stampMs) {
  return { ...stripSettingsStamp(settings), [SETTINGS_STAMP_FIELD]: new Date(stampMs || 0).toISOString() };
}

/* When the cloud copy of the settings last changed. */
export function cloudSettingsStamp(row) {
  if (!row) return 0;
  const { stamp } = splitCloudSettings(row.settings);
  if (stamp !== null) return stamp;
  return Date.parse(row.updated_at || 0) || 0;
}

/* What a device keeps of the previous person's settings when somebody
   else signs in: the light/dark choice, which is how this screen looks
   in this trailer, not anything about the person. Their own custom task,
   hazard and control lists go -- those are theirs. */
export function deviceOnlySettings(settings) {
  return {
    theme: isPlainObject(settings) && typeof settings.theme === 'string' ? settings.theme : 'light',
    customQuick: { task: [], hazard: [], control: [] },
  };
}

/* ── Whose templates are these? ───────────────────────────────────────────
   Templates and settings live on the DEVICE, but the sync row belongs to
   an ACCOUNT. On the one iPad in a job trailer that meant: A signs out, B
   signs in, and B's first sync merged every one of A's templates (job
   sites, crew leads, phone numbers) into B's account, forever. Audit
   2026-09-30.

   So the device remembers whose templates it is holding (the "owner",
   recorded after a successful sync). The rules, all in one pure function
   so they can be tested without a database:

   - Same person as last time, or nobody recorded yet (every device that
     synced before this change): merge exactly as before. Nobody's
     existing templates vanish because of this fix.
   - Somebody ELSE: nothing on the device goes up. The cloud copy is taken
     as it is, plus whatever that person left in their own stash on this
     device the last time somebody else took over (see syncMeta.js). The
     previous person's copy is stashed by the caller, not thrown away --
     it may hold templates they made offline that never reached the cloud.

   Returns { switched, templates, tombstones, settings, settingsStamp,
   cloudWins }. `settings` never carries the stamp; `cloudWins` means "the
   device should take `settings`" (always true on a switch). */
export function planSync({ uid, owner, local, stash, row }) {
  const switched = Boolean(owner) && Boolean(uid) && owner !== uid;
  const cloud = splitCloudSettings(row?.settings);
  const cloudStamp = cloudSettingsStamp(row);
  const hasCloudSettings = Boolean(row) && Object.keys(cloud.settings).length > 0;
  const localSettings = stripSettingsStamp(local?.settings);

  if (!switched) {
    const tombstones = mergeTombstones(local?.tombstones, row?.template_tombstones);
    const templates = mergeTemplates(local?.templates, row?.templates, tombstones);
    const localStamp = Number(local?.settingsStamp) || 0;
    const cloudWins = Boolean(row) && cloudStamp > localStamp;
    return {
      switched,
      tombstones,
      templates,
      cloudWins,
      settings: cloudWins ? { ...localSettings, ...cloud.settings } : localSettings,
      settingsStamp: cloudWins ? cloudStamp : localStamp,
    };
  }

  const mine = isPlainObject(stash) ? stash : null;
  const tombstones = mergeTombstones(mine?.tombstones, row?.template_tombstones);
  const templates = mergeTemplates(mine?.templates, row?.templates, tombstones);
  const stashStamp = Number(mine?.settingsStamp) || 0;
  const stashSettings = isPlainObject(mine?.settings) ? stripSettingsStamp(mine.settings) : null;
  const base = deviceOnlySettings(localSettings);

  let settings;
  let settingsStamp;
  if (stashSettings && (!hasCloudSettings || stashStamp > cloudStamp)) {
    settings = { ...base, ...stashSettings };
    settingsStamp = stashStamp;
  } else if (hasCloudSettings) {
    settings = { ...base, ...cloud.settings };
    settingsStamp = cloudStamp;
  } else {
    settings = base;
    settingsStamp = 0;
  }
  return { switched, tombstones, templates, cloudWins: true, settings, settingsStamp };
}
