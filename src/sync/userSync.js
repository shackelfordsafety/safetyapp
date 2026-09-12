import { db } from '../archive/archiveClient';
import { readTombstones, writeTombstones, localSettingsStamp } from './syncMeta';
import { mergeTemplates, mergeTombstones } from './mergeRules';
import { IS_DEMO } from '../shared/demoMode';

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

/* What is safe and useful to carry between a man's own devices.

   "Same info as last time?" only ever reuses the JOB: the site, the
   number, the crew leads, the tasks, the hazards, the controls. Everything
   day-specific is reset the moment it is applied anyway
   (makeTodayFromTemplate does it), so sending it would be pointless
   weight on a job-trailer connection.

   The crew signatures are the ones that MUST NOT travel. They are images
   of real men's signatures, they are already recorded properly against
   the publication they belong to, and a copy of them riding around in a
   sync row serves nobody. Stripped here, before the upload, not filtered
   out on the way back down -- so they are never sent in the first place. */
function stripForRepeat(model) {
  if (!model || typeof model !== 'object') return null;
  const {
    crewSignatures, signInMode, archivedPublicationId,
    date, timeIssued, timeExpired, tailgateTopic, previousDaySafety,
    notes, lastSavedAt, status, completedAt,
    ...job
  } = model;
  return job;
}

/* Newest wins, by when the JSA was actually finished -- not by which
   device synced last. Same lesson as the settings stamp: "most recently
   opened" is not "newest". */
function newerSnapshot(a, b) {
  const at = Date.parse(a?.savedAt || 0) || 0;
  const bt = Date.parse(b?.savedAt || 0) || 0;
  if (!a?.model) return b?.model ? b : null;
  if (!b?.model) return a;
  return bt > at ? b : a;
}

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
export async function syncUserData({ templates, settings, lastJsa, deviceLabel }) {
  /* Skipped entirely on the testing site, not just the write half. A demo
     that pulled the real account's templates down would also push whatever
     the owners invented back up into it, and Fonzo would find their
     experiments in his own list tomorrow morning. */
  if (IS_DEMO) return null;

  const uid = await userId();
  if (!uid) return null;

  const { data: row, error } = await db
    .from('user_sync')
    .select('templates, template_tombstones, settings, last_jsa, updated_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;

  /* Ridden along on a trip that was already happening: does this account
     still have no name on it? Everyone in the system got their name typed
     in by hand or has none at all, and somebody who is never asked will
     never go looking for the setting. */
  let needsName = false;
  try {
    const { data: prof } = await db
      .from('profiles').select('full_name').eq('id', uid).maybeSingle();
    needsName = !String(prof?.full_name || '').trim();
  } catch { /* a missing profile is not worth failing a sync over */ }

  const localTombs = readTombstones();
  const tombstones = mergeTombstones(localTombs, row?.template_tombstones);
  const mergedTemplates = mergeTemplates(templates, row?.templates, tombstones);

  const cloudSettingsStamp = Date.parse(row?.updated_at || 0) || 0;
  const cloudWins = Boolean(row) && cloudSettingsStamp > localSettingsStamp();
  const mergedSettings = cloudWins
    ? { ...settings, ...(row.settings || {}) }
    : settings;

  writeTombstones(tombstones);

  /* The last JSA, so "same info as last time?" answers the same on the
     phone and the iPad. Stripped on the way UP -- crew signatures and
     day-specific fields never leave the device. */
  const localJsa = lastJsa?.model
    ? { savedAt: lastJsa.savedAt, model: stripForRepeat(lastJsa.model) }
    : null;
  const mergedJsa = newerSnapshot(localJsa, row?.last_jsa || null);

  const before = JSON.stringify([row?.templates || [], row?.settings || {}, row?.template_tombstones || [], row?.last_jsa || null]);
  const after = JSON.stringify([mergedTemplates, mergedSettings, tombstones, mergedJsa]);
  if (before !== after) {
    const { error: upErr } = await db.from('user_sync').upsert({
      user_id: uid,
      templates: mergedTemplates,
      template_tombstones: tombstones,
      settings: mergedSettings,
      last_jsa: mergedJsa,
      updated_at: new Date().toISOString(),
      updated_by_device: deviceLabel || null,
    }, { onConflict: 'user_id' });
    if (upErr) throw upErr;
  }

  /* jsaFromCloud is set only when the cloud's copy actually won, so the
     caller knows whether there is anything to write to this device. */
  const jsaFromCloud = mergedJsa && mergedJsa !== localJsa ? mergedJsa : null;
  return { templates: mergedTemplates, settings: mergedSettings, cloudWins, needsName, jsaFromCloud };
}
