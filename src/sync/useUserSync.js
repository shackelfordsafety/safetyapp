import { useCallback, useEffect, useRef } from 'react';
import { loadModule } from '../shared/loadModule';
import { readStoredSession, deviceName } from '../shared/session';
/* Pure functions that import nothing -- safe to load eagerly, unlike
   userSync.js which drags the whole Supabase library in with it. */
import { mergeTemplates } from './mergeRules';
import { readTombstones } from './syncMeta';
import { readLastFinished, writeLastFinished } from '../shared/handOff';

/* ── Keeping templates and settings in step across devices ───────────────
   Deliberately quiet. This never shows a spinner, never blocks a screen,
   and never reports a failure to the user: if the network is not there,
   the local copy is simply what you have, which is exactly how this app
   behaved before sync existed. The only visible effect of it working is
   that a template made on the phone is on the iPad later.

   Nothing is loaded at all until somebody is signed in -- readStoredSession
   answers that from localStorage with no library, so a signed-out
   superintendent never downloads a byte of this. */

const DEBOUNCE_MS = 1500;

export function useUserSync({ templates, setTemplates, settings, setSettings, onNeedsName }) {
  const lastSyncedRef = useRef('');
  const busyRef = useRef(false);
  // Read through refs so the sync callback never has to be rebuilt when
  // the data changes -- otherwise every keystroke in Settings would tear
  // down and re-arm the timers below.
  const dataRef = useRef({ templates, settings });
  dataRef.current = { templates, settings };

  const run = useCallback(async () => {
    if (busyRef.current) return;
    if (!readStoredSession()) return;
    busyRef.current = true;
    /* What this device held when the round trip STARTED. A sync takes a
       second or two on a job-site connection, and a man can easily save a
       template in that window -- so the merged answer coming back is an
       answer to an older question. Compared against now, below. */
    const startedWith = dataRef.current;
    try {
      const mod = await loadModule(() => import('./userSync'));
      if (!mod) return;
      const merged = await mod.syncUserData({
        templates: dataRef.current.templates,
        settings: dataRef.current.settings,
        /* Read at the moment of the call rather than held in state: it is
           written by the hand-off when a JSA is published, which never
           goes through React state at all. */
        lastJsa: readLastFinished('jsa'),
        deviceLabel: deviceName(),
      });
      if (!merged) return;

      if (onNeedsName) onNeedsName(Boolean(merged.needsName));

      /* A JSA finished on another device. Written straight to storage in
         exactly the shape the local hand-off writes, so "Same info as last
         time?" cannot tell the two apart -- which is the whole point:
         "i need it across devices wherever you're signed in". */
      if (merged.jsaFromCloud) writeLastFinished('jsa', merged.jsaFromCloud);

      /* Did anything change on this device while the round trip was out?
         If so, the merged list coming back does not know about it, and
         writing it straight into state would delete a template somebody
         had just saved -- gone from the screen AND from storage, with
         nothing left to bring it back. Found by an outside reviewer,
         2026-09-11. */
      const templatesMovedUnderUs =
        JSON.stringify(dataRef.current.templates) !== JSON.stringify(startedWith.templates);
      const settingsMovedUnderUs =
        JSON.stringify(dataRef.current.settings) !== JSON.stringify(startedWith.settings);

      /* The same merge rules the cloud half uses, run once more against
         what the device holds NOW, so the just-saved template survives
         alongside whatever came down. */
      const nextTemplates = templatesMovedUnderUs
        ? mergeTemplates(dataRef.current.templates, merged.templates, readTombstones())
        : merged.templates;

      /* Only mark this as synced when it really is. If something moved
         under us the cloud has not seen it yet, and leaving the mark stale
         is exactly what makes the debounce below run again and push it. */
      if (!templatesMovedUnderUs && !settingsMovedUnderUs) {
        lastSyncedRef.current = JSON.stringify([merged.templates, merged.settings]);
      }

      // Only touch React state when the merge actually produced something
      // different, so a sync that changes nothing cannot re-trigger itself.
      if (JSON.stringify(nextTemplates) !== JSON.stringify(dataRef.current.templates)) {
        setTemplates(nextTemplates);
      }
      /* A settings edit made during the round trip is newer than anything
         the cloud had when it started, so the local one stays. */
      if (merged.cloudWins && !settingsMovedUnderUs
        && JSON.stringify(merged.settings) !== JSON.stringify(dataRef.current.settings)) {
        setSettings(merged.settings);
      }
    } catch {
      /* Offline, signed out mid-flight, or the row was busy. Local stays
         authoritative and the next focus or edit tries again. There is
         nothing here worth interrupting a man at a tailgate meeting for. */
    } finally {
      busyRef.current = false;
    }
  }, [setTemplates, setSettings, onNeedsName]);

  // On open, and whenever the app comes back to the foreground -- which on
  // an iPad is what "picking it up again" actually looks like.
  useEffect(() => {
    run();
    const onFocus = () => run();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [run]);

  // And shortly after anything changes locally, so a template saved on one
  // device is on the others by the time you pick them up.
  useEffect(() => {
    const payload = JSON.stringify([templates, settings]);
    if (payload === lastSyncedRef.current) return undefined;
    const t = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [templates, settings, run]);

  /* Handed back so publishing a JSA can push it up straight away.
     Publishing writes the snapshot to storage and touches neither
     templates nor settings, so nothing above would notice -- and a man who
     publishes on his phone at 6am and puts it in his pocket may not give
     this app another focus event before he picks up the iPad. */
  return run;
}
