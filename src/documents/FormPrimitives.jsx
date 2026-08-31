import { useId, useRef, useLayoutEffect, useEffect, useState } from 'react';
import SignaturePad from '../incident/SignaturePad';
import { useLocked } from './lockedContext';
import SpeakButton from '../voice/SpeakButton';

/* ── Shared field-section/builder primitives for the four new documents ──
   Modeled directly on the local presentational primitives IncidentWorkflow.jsx
   already defines for itself (Field/TextAreaField/YesNoToggle/StepPanel/
   StepFooter/Stepper) — those stay exactly as they are (Incident's own
   comment explains why: zero coupling to anything outside incidentModel.js).
   This module is the same idea generalized slightly (N-option toggle
   instead of yes/no-only, generic steps array instead of INCIDENT_STEPS)
   so the four new documents share ONE copy instead of writing their own
   four times. JSA and Incident are not touched or retrofitted.

   Reuses existing global CSS classes from styles.css (.field, .stepPanel,
   .stepFooter, .stepperWrap, .builderHeader*, .helperText) and from
   incident.css (.yesNoToggle, .chipGrid/.chipToggle, .cardRowHeader,
   .incidentReadinessList) — those were already app-wide, not incident-only,
   the moment main.jsx imported both stylesheets globally. Re-exported here
   under generic names so a Disciplinary/Separation/etc. component never has
   to reference "incident" in its own code to use them. */


export function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  const locked = useLocked();
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} disabled={locked} />
    </label>
  );
}

export function SelectField({ label, value, onChange, options, placeholder = 'Select…' }) {
  const locked = useLocked();
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value || ''} onChange={e => onChange(e.target.value)} disabled={locked}>
        <option value="" disabled>{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

export function TextAreaField({ label, help, value, onChange, rows = 4, placeholder = '', voice = false }) {
  const locked = useLocked();
  const ref = useRef(null);
  const labelId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <label className="field">
      <div className="fieldLabelRow">
        <span id={labelId}>{label}</span>
        {voice && <SpeakButton value={value} onChange={onChange} disabled={locked} />}
      </div>
      {help && <small>{help}</small>}
      <textarea ref={ref} rows={rows} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="autoGrow" disabled={locked} aria-labelledby={voice ? labelId : undefined} />
    </label>
  );
}

/* Generic N-option segmented toggle — YesNoToggle generalized. `options` is
   [{ value, label, tone }] where tone is 'yes'|'no'|undefined, reusing the
   same .yesNoToggle button.active.yes/.no color rules for a 2-option case;
   a 3+ option toggle (e.g. warning level) just omits tone and gets the
   neutral active state. */
export function SegmentedToggle({ label: lbl, value, onChange, options, disabledValues }) {
  const locked = useLocked();
  return (
    <div className="field">
      <span>{lbl}</span>
      <div className={`yesNoToggle${options.length > 2 ? ' wrap' : ''}`}>
        {options.map(opt => {
          const optDisabled = locked || (disabledValues || []).includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={value === opt.value}
              aria-disabled={optDisabled}
              className={`btn${value === opt.value ? ` active${opt.tone ? ` ${opt.tone}` : ''}` : ''}`}
              // Guarded onClick rather than the native disabled attribute --
              // disabled would dim the final selected answer (via .btn:disabled
              // { opacity: .45 }) exactly when it most needs to stay readable.
              onClick={() => { if (!optDisabled) onChange(opt.value); }}
              style={optDisabled && value !== opt.value ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function YesNoField({ label, value, onChange }) {
  return (
    <SegmentedToggle
      label={label}
      value={value}
      onChange={onChange}
      options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }]}
    />
  );
}

/* Check-all-that-apply chip group — same visual language as Incident's
   injury-nature chips (.chipGrid/.chipToggle). `selected` is an array of
   currently-checked option strings. */
export function ChipGroup({ label, options, selected, onToggle }) {
  const locked = useLocked();
  return (
    <div className="field">
      {label && <span>{label}</span>}
      <div className="chipGrid">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            aria-pressed={(selected || []).includes(opt)}
            aria-disabled={locked}
            className={`chipToggle${(selected || []).includes(opt) ? ' active' : ''}`}
            onClick={() => { if (!locked) onToggle(opt); }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StepPanel({ title, intro, children }) {
  return (
    <div className="stepPanel">
      <div className="stepPanelHeader">
        <h3>{title}</h3>
        {intro && <p>{intro}</p>}
      </div>
      <div className="incidentStepGrid">{children}</div>
    </div>
  );
}

/* Numbered sub-section within a StepPanel — used to give a long form
   (e.g. Disciplinary Notice's 7 numbered sections) clear visual hierarchy
   instead of one undifferentiated wall of text areas. */
export function NumberedSection({ number, title, help, children }) {
  return (
    <div className="formSection numberedSection">
      <span className="formSectionHeading">
        {number != null && <span className="numberedSectionBadge">{number}</span>}
        {title}
      </span>
      {help && <p className="helperText numberedSectionHelp">{help}</p>}
      {children}
    </div>
  );
}

export function StepFooter({ onBack, onNext, hasBack, hasNext, nextLabel, backLabel }) {
  return (
    <div className="stepFooter">
      <div className="leftBtns">
        {hasBack && <button type="button" className="btn ghost" onClick={onBack}>{backLabel || 'Back'}</button>}
      </div>
      <div className="rightBtns">
        {hasNext && <button type="button" className="btn primary" onClick={onNext}>{nextLabel || 'Next'}</button>}
      </div>
    </div>
  );
}

/* ── Vertical step list (C2 redesign) ──
   Replaces the old horizontal stepperRail everywhere. `checks` is each
   document's own readiness-check array (already computed by every workflow
   for its Review step — see getXReadinessChecks in each model file), each
   entry shaped { key, label, ok, step }. Per-row state is derived from that
   real data rather than a fabricated copy string:
     - the active step always reads "You are here"
     - a step whose tagged checks are all ok reads "Done"
     - a step with SOME but not all of its checks ok reads the first failing
       check's own label (e.g. "Manager signature") — something was started
       and a specific thing is still missing
     - a step with NONE of its checks started yet reads "Not started"
     - a step with no checks of its own reads "Done" unconditionally —
       there's nothing on that screen itself to be half-done (this is what
       makes always-optional steps like Incident's Witnesses/Photos never
       block anything). The one exception is the terminal step (last in
       `steps`, e.g. Review/Finish & Export): since it has no checks of its
       own either but its whole point is "is everything else done," it
       reads "Done" once every check in the whole document passes, else
       "Not started". (Fixed 2026-08-28 — every no-check step used to fall
       into the terminal branch, so Witnesses/Photos read "Not started"
       forever no matter how long you left them alone, only flipping to
       "Done" once the entire rest of the document passed.)
     - `lockedIds` (optional, e.g. JSA's Signatures/Finish & Export before
       Job/Meeting/Work are complete) overrides all of the above with a
       plain "Locked" state -- without this, a step whose own checks happen
       to already be satisfied by a default value (e.g. JSA's signature
       line count, which defaults to 30) reads "Done" even though jumping
       to it actually gets redirected away, which is exactly backwards
       (Fonzo field report, 2026-08-19: "i don't see signatures is actually
       grayed out, i see it green w a check"). Still loses to "You are
       here" so a step doesn't lock itself out from under the user who's
       currently standing on it. */
function stepRowState(step, activeStepId, checks, lockedIds, isTerminal) {
  if (step.id === activeStepId) return { kind: 'current', text: 'You are here' };
  if (lockedIds && lockedIds.includes(step.id)) return { kind: 'locked', text: 'Locked' };
  const stepChecks = checks.filter(c => c.step === step.id);
  if (!stepChecks.length) {
    if (!isTerminal) return { kind: 'done', text: 'Done' };
    return checks.every(c => c.ok) ? { kind: 'done', text: 'Done' } : { kind: 'pending', text: 'Not started' };
  }
  const okCount = stepChecks.filter(c => c.ok).length;
  if (okCount === stepChecks.length) return { kind: 'done', text: 'Done' };
  if (okCount > 0) {
    const firstMissing = stepChecks.find(c => !c.ok);
    return { kind: 'attention', text: firstMissing ? firstMissing.label : 'Needs info' };
  }
  return { kind: 'pending', text: 'Not started' };
}

function IconLockDot(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" {...props}>
      <rect x="5" y="10.5" width="14" height="9" rx="1.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

export function StepNav({ steps, activeStepId, checks, onJump, lockedIds, ariaLabel = 'Document steps' }) {
  const rows = steps.map((s, i) => ({ step: s, ...stepRowState(s, activeStepId, checks, lockedIds, i === steps.length - 1) }));
  const doneCount = rows.filter(r => r.kind === 'done').length;
  return (
    <nav className="stepNav" aria-label={ariaLabel}>
      <span className="stepNavHead">Steps &mdash; {doneCount} of {steps.length} done</span>
      <div className="stepNavList" role="tablist" aria-label={ariaLabel} aria-orientation="vertical">
        {rows.map((r, i) => (
          <button
            key={r.step.id}
            type="button"
            role="tab"
            aria-selected={r.kind === 'current'}
            aria-current={r.kind === 'current' ? 'step' : undefined}
            aria-label={`${r.step.label}: ${r.text}`}
            className={`stepNavRow ${r.kind}`}
            onClick={() => onJump(r.step.id)}
          >
            <span className="stepNavDot" aria-hidden="true">{r.kind === 'locked' ? <IconLockDot /> : r.kind === 'done' ? '✓' : r.kind === 'attention' ? '!' : i + 1}</span>
            <span className="stepNavText">
              <strong>{r.step.label}</strong>
              <span className="stepNavState">{r.text}</span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/* Generic builder top bar — same markup IncidentWorkflow renders inline
   for itself, extracted so four new documents don't each hand-roll the
   same header/badge/save-status/back-button block. Steps render as their
   own full-width StepNav bar below this header (see each Workflow
   component's JSX), not inside it, so this no longer takes step-related props. */
export function BuilderHeader({ kicker, title, statusBadgeLabel, statusBadgeClass, saveStatus, saveStatusState, onSaveNow, onBack, backLabel }) {
  return (
    <div className="builderHeader">
      <div className="builderHeaderTitleRow">
        <div className="builderHeaderTitleBlock">
          <span className="builderHeaderKicker">{kicker}</span>
          <h1 className="builderHeaderTitle">{title}</h1>
        </div>
        <button type="button" className="backBtn" onClick={onBack}>&larr; {backLabel || 'Documents'}</button>
      </div>
      <div className="builderHeaderTop">
        <div className="builderHeaderBadges">
          <span className={`badge ${statusBadgeClass}`}>{statusBadgeLabel}</span>
          <span className={`builderHeaderSaved${saveStatusState === 'error' ? ' error' : ''}`}>{saveStatus}</span>
          <button type="button" className="btn ghost sm" onClick={onSaveNow} disabled={saveStatusState === 'saving'}>Save Now</button>
        </div>
      </div>
    </div>
  );
}

// Pending rows become buttons that jump straight to the step that needs
// attention (onJump receives the whole check, so the caller can read
// chk.step / chk.fieldId) -- "the user should not have to hunt" per the
// zero-training mission. Completed rows stay non-interactive; there's
// nothing to jump to once a check is satisfied.
export function ReadinessChecklist({ checks, onJump }) {
  return (
    <div className="incidentReadinessList">
      {checks.map(chk => (
        <button
          key={chk.key}
          type="button"
          className={`incidentReadinessItem ${chk.ok ? 'ok' : 'pending'}`}
          onClick={() => onJump?.(chk)}
          disabled={chk.ok || !onJump || !chk.step}
        >
          <span className="checkIcon">{chk.ok ? '✓' : '•'}</span>
          <span>{chk.label}</span>
        </button>
      ))}
    </div>
  );
}

/* Review & Export step body — generic across all four new documents.
   `status` is 'draft' | 'ready' | 'completed' (both 'ready' and 'completed'
   are the finished/locked state -- see isXPrintFinal in each model file).
   One primary action only (Download Document) -- no competing Share/Print
   choice, and user-facing copy avoids PDF/publication jargon (see the
   app-wide download/print UX simplification mission). Internal PDF
   terminology (pdfExportState, onGeneratePdf, etc.) is left as-is; only
   what the user reads changed.

   Finishing (onMarkReady) is gated behind a confirmation dialog -- it locks
   the document from further editing (see LockedContext / useLocked, applied
   by each Workflow component around its step content), so it must never
   fire from a single accidental tap. */
export function ReviewExportPanel({
  title, checks, checklistComplete, status,
  draftExplainText, markReadyHintText, onMarkReady, onMarkIncomplete,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload,
  generatingLabel = 'Creating…', generateLabel = 'Create Document', regenerateLabel = 'Update Document',
  downloadLabel = 'Download Document',
  onStartNew, startNewLabel = 'Start a new report',
  onExportDraft,
  onBack, onJumpCheck,
}) {
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const isGenerating = pdfExportState?.phase === 'generating';
  const isReady = pdfExportState?.phase === 'ready';
  const remainingCount = checks.filter(c => !c.ok).length;
  return (
    <StepPanel title={title}>
      <div className="card">
        <div className="cardHeader">
          <strong>Readiness</strong>
        </div>
        {status === 'draft' && (
          <p className="helperText">
            {checklistComplete
              ? markReadyHintText
              /* Say exactly how much is left and that the rows are tappable —
                 "complete the checklist below" made the user count for
                 themselves and didn't reveal that a row jumps to its field. */
              : `${remainingCount} ${remainingCount === 1 ? 'item' : 'items'} still needed — tap one to go straight to it.`}
          </p>
        )}
        <ReadinessChecklist checks={checks} onJump={status === 'draft' ? onJumpCheck : undefined} />
        {status !== 'draft' && (
          <p className="helperText">Marked complete. Editing is locked while it's marked this way — creating or updating the PDF does not change this.</p>
        )}
        <SegmentedToggle
          label="Is this document complete?"
          value={status === 'draft' ? 'no' : 'yes'}
          disabledValues={status === 'draft' && !checklistComplete ? ['yes'] : []}
          onChange={v => {
            if (v === 'yes') { if (checklistComplete) setConfirmingFinish(true); }
            else if (status !== 'draft') onMarkIncomplete();
          }}
          options={[{ value: 'yes', label: 'Yes', tone: 'yes' }, { value: 'no', label: 'No', tone: 'no' }]}
        />
        {confirmingFinish && (
          <ConfirmDialog
            title="Mark this document complete?"
            message={[
              'Marking it complete locks the fields from further editing and removes the DRAFT watermark from the PDF.',
              'You can come back here and choose "Mark Incomplete" any time to unlock it and keep editing.',
            ]}
            confirmLabel="Mark Complete"
            onCancel={() => setConfirmingFinish(false)}
            onConfirm={() => { setConfirmingFinish(false); onMarkReady(); }}
          />
        )}
      </div>

      <div className="card">
        {!isReady && (
          <div className="reviewPrimaryAction">
            <button type="button" className="btn primary lg" onClick={onGeneratePdf} disabled={isGenerating} aria-busy={isGenerating}>
              {isGenerating ? generatingLabel : generateLabel}
            </button>
          </div>
        )}

        {onExportDraft && (
          <div className="reviewSecondaryActions">
            <button type="button" className="btn ghost sm" onClick={onExportDraft}>Send to Someone Else to Finish</button>
            <span className="reviewAutosaveNote">Saves a file to text, email, or AirDrop — they pick up right where you left off, no need to finish the checklist first.</span>
          </div>
        )}

        {isReady && isPdfStale && (
          <div className="pdfStaleWarning">
            <strong>Document changed &mdash; update it before downloading.</strong>
            <button type="button" className="btn primary sm" onClick={onGeneratePdf} disabled={isGenerating} aria-busy={isGenerating}>{regenerateLabel}</button>
          </div>
        )}

        {isReady && !isPdfStale && (
          <div className="pdfReadyPanel">
            <span className="pdfReadyEyebrow">Document Ready</span>
            <strong className="pdfReadyHeadline">{pdfExportState.pageCount} page{pdfExportState.pageCount === 1 ? '' : 's'}</strong>
            <p className="pdfReadyFilename">{pdfExportState.filename}</p>
            <div className="pdfReadyActions">
              <button type="button" className="btn primary lg" onClick={onDownload}>{downloadLabel}</button>
            </div>
            <p className="helperText pdfReadyHelper">Download the document, then open it to print.</p>
          </div>
        )}
      </div>

      {onStartNew && <button type="button" className="btn ghost reviewStartNew" onClick={onStartNew}>{startNewLabel}</button>}
      <StepFooter hasBack onBack={onBack} />
    </StepPanel>
  );
}

/* ── Accessible modal dialog primitive: focus trap, Escape to cancel, focus
   returns to whatever triggered it on close ── same behavior as main.jsx's
   own local useFocusTrapDialog (used by ConfirmReplaceDialog for JSA);
   duplicated in one place rather than exported from main.jsx since main.jsx
   exports nothing and JSA's own dialog stays deliberately self-contained.
   Shared here so Incident and the four Superintendent documents don't each
   reimplement it for their own Finish Document confirmation. */
function useFocusTrapDialog(onCancel) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog ? Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) : [];
    focusable[0]?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab' || !focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [onCancel]);
  return dialogRef;
}

/* Generic confirm/cancel dialog -- used for the Finish Document confirmation
   (see the app-wide draft/finish/lock UX mission) so finishing a document is
   never one accidental tap: it explains that finishing locks the document
   from further editing, that downloading/printing still works, and that it
   can't be undone, before anything actually changes. `message` accepts
   multiple paragraphs as an array of strings. */
export function ConfirmDialog({ title, message, cancelLabel = 'Cancel', confirmLabel, onCancel, onConfirm }) {
  const dialogRef = useFocusTrapDialog(onCancel);
  const paragraphs = Array.isArray(message) ? message : [message];
  return (
    <div className="dialogOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialogPanel" role="alertdialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogBody" ref={dialogRef}>
        <h3 id="confirmDialogTitle">{title}</h3>
        <div id="confirmDialogBody">
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <div className="dialogActions">
          <button type="button" className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Layout capability hooks (C2 redesign phase 3) ──
   Duplicated from main.jsx's private useIsTouchPrimary/useElementWidth
   (touch-primary detection uses a real hardware-capability media feature,
   not a viewport-width guess; container width is measured on the actual
   rendered element via ResizeObserver, not window.innerWidth) rather than
   imported -- main.jsx exports nothing. Shared here, once, since all four
   documents in this module need the same side-by-side/stacked preview
   layout JSA and Incident already use on their own Review steps. */
export function useIsTouchPrimary() {
  const readMatch = () => (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(any-pointer: coarse)').matches
    : false;
  const [touch, setTouch] = useState(readMatch);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(any-pointer: coarse)');
    const handler = () => setTouch(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return touch;
}
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/* ── Doc facsimile (C2 redesign phase 3b) ──
   Disciplinary, Separation, Medical Event, and Uncontrolled Event draw
   their PDF directly via pdfDraw.js stencil calls (see that file's header
   comment) -- there is no live DOM page to reuse the way JSA/Incident's
   preview does. This is hand-built markup that mirrors each doc's own
   drawXPdf() call sequence -- see each *PdfDraw.js's own xFacsimileBlocks()
   export, kept right next to drawXPdf so a future edit to one is visible
   next to the other. Content order and field labels match the real PDF;
   exact pagination does not -- this renders as one continuous sheet rather
   than reimplementing pdfDraw.js's dynamic page-break measurement. */
const SHACKELFORD_LOGO_SRC = `${import.meta.env.BASE_URL}icons/shackelford-logo.webp`;

export function DocFacsimile({ formTitle, draft, blocks }) {
  return (
    <div className="docFacsimile">
      <div className="docFacsimileHeader">
        <img src={SHACKELFORD_LOGO_SRC} alt="Shackelford Construction and Hauling" className="docFacsimileLogo" />
        <h2>{formTitle}</h2>
      </div>
      {blocks.map((block, i) => <FacsimileBlock key={i} block={block} />)}
      {draft && <div className="docFacsimileWatermark">DRAFT</div>}
    </div>
  );
}

function FacsimileInfoTable({ rows }) {
  return (
    <div className="facsimileInfoTable">
      {rows.map((row, i) => (
        <div className={`facsimileInfoRow${row.length === 4 ? ' quad' : ''}`} key={i}>
          <span className="facsimileInfoCellLabel">{row[0]}</span>
          <span className="facsimileInfoCellValue">{row[1]}</span>
          {row.length === 4 && (
            <>
              <span className="facsimileInfoCellLabel">{row[2]}</span>
              <span className="facsimileInfoCellValue">{row[3]}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function FacsimileCheckboxGrid({ options, checked, columns = 2 }) {
  const list = Array.isArray(checked) ? checked : [checked].filter(Boolean);
  return (
    <div className="facsimileCheckboxGrid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {options.map(opt => (
        <span className="facsimileCheckboxItem" key={opt}>
          <span className={`facsimileCheckboxBox${list.includes(opt) ? ' checked' : ''}`} aria-hidden="true" />
          {opt}
        </span>
      ))}
    </div>
  );
}

function FacsimileSignatureSlot({ label, nameValue, dataUrl, dateValue, note }) {
  return (
    <div className="facsimileSignatureRow">
      <div className="facsimileSignatureSlot sig">
        {nameValue !== undefined && <span className="facsimileSignatureName">{nameValue || ' '}</span>}
        <div className="facsimileSignatureArt">
          {note ? <span className="facsimileSignatureNote">{note}</span>
            : dataUrl ? <img className="facsimileSignatureImg" src={dataUrl} alt="" /> : null}
        </div>
        <span className="facsimileSignatureLine">{label}</span>
      </div>
      {!note && (
        <div className="facsimileSignatureSlot date">
          <div className="facsimileSignatureArt"><span>{dateValue || ''}</span></div>
          <span className="facsimileSignatureLine">Date</span>
        </div>
      )}
    </div>
  );
}

function FacsimileBlock({ block }) {
  switch (block.type) {
    case 'infoTable':
      return <FacsimileInfoTable rows={block.rows} />;
    case 'grayBar':
      return <div className="facsimileGrayBar">{block.text}</div>;
    case 'numberedBar':
      return <div className="facsimileNumberedBar">{block.number != null ? `${block.number}. ` : ''}{block.text}</div>;
    case 'fieldLabel':
      return <div className={`facsimileFieldLabel${block.caps === false ? ' noCaps' : ''}`}>{block.text}</div>;
    case 'note':
      return <div className="facsimileNote">{block.text}</div>;
    case 'textBox':
      return (
        <div className="facsimileTextBoxWrap">
          {block.title && <div className="facsimileFieldLabel">{block.title}</div>}
          <div className="facsimileTextBox">{block.text || ''}</div>
        </div>
      );
    case 'checkboxGrid':
      return <FacsimileCheckboxGrid options={block.options} checked={block.checked} columns={block.columns} />;
    case 'twoCol':
      return (
        <div className="facsimileTwoCol">
          <div className="facsimileTwoColCol">{block.colA.map((b, i) => <FacsimileBlock key={i} block={b} />)}</div>
          <div className="facsimileTwoColCol">{block.colB.map((b, i) => <FacsimileBlock key={i} block={b} />)}</div>
        </div>
      );
    case 'signatureRow':
      return <FacsimileSignatureSlot {...block} />;
    case 'multiSignatureRow':
      return (
        <div className="facsimileMultiSignatureRow">
          {block.items.map((item, i) => <FacsimileSignatureSlot key={i} {...item} />)}
        </div>
      );
    default:
      return null;
  }
}

export { SignaturePad };
