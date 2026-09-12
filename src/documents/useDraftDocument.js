import { useEffect, useRef, useState } from 'react';
import { loadDraft, saveDraft, clearDraft } from './storage';
import { printedFingerprint } from './printedFingerprint';
import { workWasClearedForSignOut } from '../shared/clearOnSignOut';

/* ── Generic single-draft document workflow state ──
   Extracted from the near-identical draft/autosave/status logic that JSA
   and Incident Report each hand-wrote in App() (see main.jsx) — this hook
   is used ONLY by the four new documents added in this mission
   (Disciplinary, Uncontrolled Event, Medical Event, Separation). JSA and
   Incident keep their own existing, unmodified implementations untouched;
   retrofitting them onto this hook is deliberately out of scope (real
   behavior differences — JSA's template system, Incident's photo-blob
   cleanup on discard — aren't worth forcing through one generic path).

   Config:
   - storageKey: one of DOCUMENT_STORAGE_KEYS (see storage.js)
   - emptyModel(): returns a fresh blank document object; must include an
     `id`, `status` ('draft'|'ready'|'completed'), `lastSavedAt`,
     `completedAt`
   - hasMeaningfulContent(model): true once autosave should start caring
   - migrateShape(raw): optional, defaults to identity — same purpose as
     incidentModel.js's migrateIncidentShape
   - firstStepId: the step id to land on when starting/loading a draft
   - active: whether this document's builder is the one currently open
     (autosave only runs while true — mirrors the `activeDoc === 'jsa'`
     gate on JSA's own autosave effect) */
export function useDraftDocument({ storageKey, emptyModel, hasMeaningfulContent, migrateShape = raw => raw, firstStepId, active }) {
  const [model, setModelRaw] = useState(() => emptyModel());
  const [savedDraft, setSavedDraft] = useState(() => {
    const raw = loadDraft(storageKey);
    return raw ? migrateShape(raw) : null;
  });
  const [step, setStep] = useState(firstStepId);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const autoSaveTimer = useRef(null);
  const lastSnapshot = useRef('');

  /* The edit that is typed but not yet written. Held in a ref so it can be
     flushed from a cleanup or an unload, neither of which can read state. */
  const pending = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    if (!hasMeaningfulContent(model)) return undefined;
    const snapshot = JSON.stringify({ ...model, lastSavedAt: '' });
    if (snapshot === lastSnapshot.current) return undefined;
    setSaveStatus('saving');
    pending.current = { snapshot, model };
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const next = { ...model, lastSavedAt: new Date().toISOString() };
      if (saveDraft(storageKey, next)) {
        lastSnapshot.current = snapshot;
        pending.current = null;
        setSavedDraft(next);
        setModelRaw(prev => ({ ...prev, lastSavedAt: next.lastSavedAt }));
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
      }
    }, 900);
    return () => clearTimeout(autoSaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, active]);

  /* Autosave waits 900ms, and leaving the screen used to cancel it. Tap
     Back within that window -- or close the tab, or have iOS discard it --
     and the last thing typed was gone, with the older saved copy loaded
     back next time as though nothing had been written. Found by an outside
     reviewer, 2026-09-11.

     The timer is still cancelled on the way out; what changed is that the
     work it was holding gets written first rather than thrown away.
     Storage only -- no setState, because by then the component is going or
     gone. */
  /* Returns what it wrote, so a caller that is still on screen (leaving one
     document for another) can keep the "in progress" badge honest. Callers
     on the way out ignore it -- setting state then does nothing. */
  function flushPending() {
    const held = pending.current;
    if (!held) return null;
    /* Signing out wipes the drafts and then reloads, and a reload looks
       exactly like leaving the page. Without this, signing out would put
       the paperwork straight back. */
    if (workWasClearedForSignOut()) { pending.current = null; return null; }
    pending.current = null;
    clearTimeout(autoSaveTimer.current);
    const next = { ...held.model, lastSavedAt: new Date().toISOString() };
    if (!saveDraft(storageKey, next)) return null;
    lastSnapshot.current = held.snapshot;
    return next;
  }

  useEffect(() => {
    const onLeave = () => flushPending();
    /* pagehide rather than beforeunload: Safari on iOS frequently never
       fires beforeunload when an app is swiped away, and this app lives on
       iPads. */
    const onHide = () => { if (document.visibilityState === 'hidden') flushPending(); };
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onHide);
      flushPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Leaving this document for another one ends the 900ms wait too, and it
     is by far the commonest way out -- this hook lives in App() and never
     unmounts, so the handler above never fires for it. Type a name, tap
     Home, and the write was cancelled with nothing to fire it again. */
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      const written = flushPending();
      if (written) setSavedDraft(written);
    }
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* Editing any field after the document was marked ready/completed
     silently returns it to draft — same rule as Incident's upd() — so a
     stale "final" PDF can never be shared/downloaded without the user
     re-confirming readiness. Callers that need an exemption (bookkeeping
     fields only) should patch `model` directly via the setter's functional
     form instead of calling upd(). */
  function upd(patch) {
    setModelRaw(prev => {
      const next = { ...prev, ...patch };
      if (prev.status !== 'draft' && printedFingerprint(next) !== printedFingerprint(prev)) {
        next.status = 'draft';
        next.completedAt = '';
      }
      return next;
    });
  }

  function saveNow() {
    clearTimeout(autoSaveTimer.current);
    setSaveStatus('saving');
    const next = { ...model, lastSavedAt: new Date().toISOString() };
    if (saveDraft(storageKey, next)) {
      lastSnapshot.current = JSON.stringify({ ...next, lastSavedAt: '' });
      setModelRaw(next);
      setSavedDraft(next);
      setSaveStatus('saved');
      return true;
    }
    setSaveStatus('error');
    return false;
  }

  function markReady(isReadyFn) {
    if (!isReadyFn(model)) return false;
    clearTimeout(autoSaveTimer.current);
    const next = { ...model, status: 'ready', lastSavedAt: new Date().toISOString() };
    if (saveDraft(storageKey, next)) {
      lastSnapshot.current = JSON.stringify({ ...next, lastSavedAt: '' });
      setModelRaw(next);
      setSavedDraft(next);
      setSaveStatus('saved');
      return true;
    }
    setSaveStatus('error');
    return false;
  }

  /* Reverses markReady() — unlocks the document for editing
     again. Finishing a document was previously one-way ("This cannot be
     undone"); real field use showed that was the wrong call, since a
     generated PDF still correctly shows DRAFT for an unfinished document,
     but the app locked the form anyway with no way back short of losing
     work. This makes Finish/Unfinish a real toggle. */
  function markIncomplete() {
    const next = { ...model, status: 'draft', completedAt: '', lastSavedAt: new Date().toISOString() };
    if (saveDraft(storageKey, next)) {
      lastSnapshot.current = JSON.stringify({ ...next, lastSavedAt: '' });
      setModelRaw(next);
      setSavedDraft(next);
      setSaveStatus('saved');
      return true;
    }
    setSaveStatus('error');
    return false;
  }

  function resetToBlank() {
    clearDraft(storageKey);
    pending.current = null; // nothing held may outlive the draft it came from
    setSavedDraft(null);
    setModelRaw(emptyModel());
    lastSnapshot.current = '';
    setStep(firstStepId);
  }

  function loadSaved() {
    const raw = loadDraft(storageKey) || savedDraft;
    if (!raw) return false;
    const normalized = { ...emptyModel(), ...migrateShape(raw) };
    setModelRaw(normalized);
    setSavedDraft(normalized);
    setStep(firstStepId);
    return true;
  }

  function hasExistingContent() {
    const persisted = loadDraft(storageKey) || savedDraft;
    return hasMeaningfulContent(persisted) || hasMeaningfulContent(model);
  }

  // Loads externally-sourced data (an imported draft file) as this
  // document's current draft — same normalization loadSaved() applies to
  // this device's own localStorage, and persisted immediately (not left to
  // the autosave debounce) so an import survives even if the tab closes
  // right after.
  function replaceWith(rawData) {
    clearTimeout(autoSaveTimer.current);
    const normalized = { ...emptyModel(), ...migrateShape(rawData) };
    setModelRaw(normalized);
    setSavedDraft(normalized);
    lastSnapshot.current = '';
    setStep(firstStepId);
    saveDraft(storageKey, normalized);
  }

  function discard() {
    clearDraft(storageKey);
    pending.current = null;
    setSavedDraft(null);
  }

  return {
    model, upd, setModel: setModelRaw,
    step, setStep,
    savedDraft, saveStatus,
    saveNow, markReady, markIncomplete, resetToBlank, loadSaved, hasExistingContent, discard, replaceWith,
  };
}

/* Same idle/saving/saved/error -> display-string mapping Incident's own
   incidentSaveStatusLabel computes inline in App() — shared here so the
   four new documents don't each repeat the ternary chain. */
export function saveStatusLabel(saveStatus, lastSavedAt) {
  if (saveStatus === 'saving') return 'Saving…';
  if (saveStatus === 'error') return 'Save failed — try Save Now';
  if (saveStatus === 'saved') return 'Saved';
  return lastSavedAt ? 'Saved' : 'Not saved yet';
}
