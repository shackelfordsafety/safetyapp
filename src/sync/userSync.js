import { db } from '../archive/archiveClient';
import { readTombstones, writeTombstones, localSettingsStamp } from './syncMeta';
import { mergeTemplates, mergeTombstones } from './mergeRules';

/* ── Your templates and settings, on every device you sign in on ─────────
   Imported ONLY from lazily loaded code, so the Supabase library stays out
   of the bundle a superintendent downloads. Nothing here ever blocks the
   app: if the network is gone, or nobody is signed in, the local copy is
   simply what you have and the screen never knows the difference.

   WHY THIS EXISTS. Fonzo works off an iPhone, a personal iPad and a work
   iPad, and each one held a separate pile of templates that never met.
   Worse: iOS Safari evicts a site's localStorage after about seven days
   of not opening it, so the iPad left in a drawer over a long weekend can
   silently lose every template on it, and there was no other copy
   anywhere. This is a backup as much as a convenience.

   WHAT IS NOT HERE: the active draft. It is edited continuously and
   offline, so it needs a real "there is a newer version, which do you
   want" conversation rather than a merge. Separate piece of work, on
   purpose -- doing it badly is how somebody loses a morning of typing. */

async function userId() {
  const { data } = await db.auth.getUser();
  return data?.user?.id || null;
}

/* One round trip: read what the cloud has, merge it with what this device
   has, write the result back if it differs, and hand the merged copy to
   the caller. Returns null when there is nothing to do (signed out), and
   throws only on a real failure the caller may want to report -- callers
   treat a throw as "stay local", never as an error worth interrupting
   anyone over. */
export async function syncUserData({ templates, settings, deviceLabel }) {
  const uid = await userId();
  if (!uid) return null;

  const { data: row, error } = await db
    .from('user_sync')
    .select('templates, template_tombstones, settings, updated_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;

  const localTombs = readTombstones();
  const tombstones = mergeTombstones(localTombs, row?.template_tombstones);
  const mergedTemplates = mergeTemplates(templates, row?.templates, tombstones);

  const cloudSettingsStamp = Date.parse(row?.updated_at || 0) || 0;
  const cloudWins = Boolean(row) && cloudSettingsStamp > localSettingsStamp();
  const mergedSettings = cloudWins
    ? { ...settings, ...(row.settings || {}) }
    : settings;

  writeTombstones(tombstones);

  const before = JSON.stringify([row?.templates || [], row?.settings || {}, row?.template_tombstones || []]);
  const after = JSON.stringify([mergedTemplates, mergedSettings, tombstones]);
  if (before !== after) {
    const { error: upErr } = await db.from('user_sync').upsert({
      user_id: uid,
      templates: mergedTemplates,
      template_tombstones: tombstones,
      settings: mergedSettings,
      updated_at: new Date().toISOString(),
      updated_by_device: deviceLabel || null,
    }, { onConflict: 'user_id' });
    if (upErr) throw upErr;
  }

  return { templates: mergedTemplates, settings: mergedSettings, cloudWins };
}
