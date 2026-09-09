import { useCallback, useEffect, useRef } from 'react';
import { loadModule } from '../shared/loadModule';
import { readStoredSession, deviceName } from '../shared/session';

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

export function useUserSync({ templates, setTemplates, settings, setSettings }) {
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
    try {
      const mod = await loadModule(() => import('./userSync'));
      if (!mod) return;
      const merged = await mod.syncUserData({
        templates: dataRef.current.templates,
        settings: dataRef.current.settings,
        deviceLabel: deviceName(),
      });
      if (!merged) return;

      lastSyncedRef.current = JSON.stringify([merged.templates, merged.settings]);

      // Only touch React state when the merge actually produced something
      // different, so a sync that changes nothing cannot re-trigger itself.
      if (JSON.stringify(merged.templates) !== JSON.stringify(dataRef.current.templates)) {
        setTemplates(merged.templates);
      }
      if (merged.cloudWins
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
  }, [setTemplates, setSettings]);

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
}
