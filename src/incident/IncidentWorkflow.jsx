import { useId, useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  INCIDENT_STEPS, INJURY_NATURE_OPTIONS, CAUSE_CATEGORIES, causeKey,
  emptyWitness, emptyTeamMember, getIncidentReadinessChecks, isIncidentReady, isIncidentPrintFinal, printedIncidentFingerprint,
} from './incidentModel';
import { incidentCopy as t } from './incidentCopy';
import SignaturePad from './SignaturePad';
import BodyDiagram from './BodyDiagram';
import IncidentPhotos from './IncidentPhotos';
import { IncidentPageShell, Page1Content } from './IncidentPdf';
import { buildIncidentPagePlan } from './incidentPdfGenerate';
import { LockedContext, useLocked } from '../documents/lockedContext';
import { ConfirmDialog, StepNav } from '../documents/FormPrimitives';
import SpeakButton from '../voice/SpeakButton';
import { downloadDraftFile, buildDraftFilename } from '../shared/draftTransfer';

/* Touch/width layout detection, duplicated from main.jsx's private
   useIsTouchPrimary/useElementWidth rather than imported -- this module is
   deliberately self-contained (see the header comment on Field/TextAreaField
   below), and these are generic device-capability hooks, not JSA logic. */
function useIsTouchPrimary() {
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
function useElementWidth(ref) {
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

/* Review-step "What will print" facsimile -- mirrors JSA's JsaPreview
   (src/main.jsx): the real page-1 DOM component, scaled down via CSS
   transform, so preview and PDF export share one markup path. Only page 1 is
   shown (plus a total-page count) -- a full flip-through of every
   continuation/witness/signature page is a larger separate feature, not
   this pass. */
function IncidentPreview({ incident }) {
  const { pages } = useMemo(() => buildIncidentPagePlan(incident), [incident]);
  const totalPages = pages.length;
  const page1 = pages[0];
  const draft = !isIncidentPrintFinal(incident);
  const viewportRef = useRef(null);
  const [scale, setScale] = useState(0.55);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => {
      const width = Math.max(280, node.clientWidth - 28);
      setScale(Math.min(1, width / 816));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="previewPageManager">
        <span><strong>Page 1</strong> shown</span>
        <span className="previewTotal"><strong>Total</strong> {totalPages}</span>
      </div>
      <div className="previewTruthBar">
        <p>Exact Letter-page preview with standard default-margin space.</p>
      </div>
      <div className="previewSheetViewport" ref={viewportRef} style={{ height: `${1056 * scale + 28}px` }}>
        <div className="previewSheetCanvas" style={{ transform: `scale(${scale})` }}>
          <IncidentPageShell pageNumber={1} totalPages={totalPages} draft={draft} watermarkVariant="page1">
            <Page1Content incident={incident} {...page1.props} />
          </IncidentPageShell>
        </div>
      </div>
    </>
  );
}

/* ── Small local presentational primitives ──
   Deliberately not imported from main.jsx (which exports nothing) -- kept
   self-contained here so the incident module has zero coupling to JSA
   internals. Visually they reuse the app's existing .field/.btn/.card
   design tokens from styles.css, they just don't share JS with StepJob's
   F/TA in main.jsx. */
function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  const locked = useLocked();
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} disabled={locked} />
    </label>
  );
}

function TextAreaField({ label, help, value, onChange, rows = 4, placeholder = '', voice = false }) {
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

function YesNoToggle({ label: lbl, value, onChange }) {
  const locked = useLocked();
  return (
    <div className="field">
      <span>{lbl}</span>
      <div className="yesNoToggle">
        <button type="button" aria-pressed={value === 'yes'} aria-disabled={locked} className={`btn${value === 'yes' ? ' active yes' : ''}`} onClick={() => { if (!locked) onChange('yes'); }}>{t.yesNo.yes}</button>
        <button type="button" aria-pressed={value === 'no'} aria-disabled={locked} className={`btn${value === 'no' ? ' active no' : ''}`} onClick={() => { if (!locked) onChange('no'); }}>{t.yesNo.no}</button>
      </div>
    </div>
  );
}

function StepPanel({ title, intro, children }) {
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

function StepFooter({ onBack, onNext, hasBack, hasNext, nextLabel }) {
  return (
    <div className="stepFooter">
      <div className="leftBtns">
        {hasBack && <button className="btn ghost" onClick={onBack}>{t.nav.back}</button>}
      </div>
      <div className="rightBtns">
        {hasNext && <button className="btn primary" onClick={onNext}>{nextLabel || t.nav.next}</button>}
      </div>
    </div>
  );
}


/* ── Step: Incident Details ── */
function StepDetails({ incident, upd, next }) {
  const c = t.details;
  return (
    <StepPanel title={c.title} intro={c.intro}>
      <Field label={c.workplaceLocation} value={incident.workplaceLocation} onChange={v => upd({ workplaceLocation: v })} />
      <div className="formPairRow">
        <Field label={c.incidentDate} type="date" value={incident.incidentDate} onChange={v => upd({ incidentDate: v })} />
        <Field label={c.incidentTime} type="time" value={incident.incidentTime} onChange={v => upd({ incidentTime: v })} />
      </div>
      <div className="formPairRow">
        <Field label={c.writtenReportDateTime} type="datetime-local" value={incident.writtenReportDateTime} onChange={v => upd({ writtenReportDateTime: v })} />
        <Field label={c.reportedToSupervisorDateTime} type="datetime-local" value={incident.reportedToSupervisorDateTime} onChange={v => upd({ reportedToSupervisorDateTime: v })} />
      </div>
      <div className="formSection">
        <span className="formSectionHeading">{c.investigatorSectionTitle}</span>
        <div className="formGrid">
          <Field label={c.investigatorName} value={incident.investigatorName} onChange={v => upd({ investigatorName: v })} />
          <Field label={c.investigatorTitle} value={incident.investigatorTitle} onChange={v => upd({ investigatorTitle: v })} />
          <div className="formPairRow">
            <Field label={c.investigatorPhone} type="tel" value={incident.investigatorPhone} onChange={v => upd({ investigatorPhone: v })} />
            <Field label={c.investigatorEmail} type="email" value={incident.investigatorEmail} onChange={v => upd({ investigatorEmail: v })} />
          </div>
        </div>
      </div>
      <Field label={c.incidentSpecificLocation} value={incident.incidentSpecificLocation} onChange={v => upd({ incidentSpecificLocation: v })} />
      <TextAreaField label={c.detailedIncidentDescription} rows={6} value={incident.detailedIncidentDescription} onChange={v => upd({ detailedIncidentDescription: v })} voice />
      <StepFooter hasNext onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Injury ── */
function StepInjury({ incident, upd, prev, next }) {
  const c = t.injury;
  const locked = useLocked();
  const injured = incident.injuryOccurred === 'yes';
  function toggleNature(opt) {
    if (locked) return;
    const cur = incident.injuryNature || [];
    upd({ injuryNature: cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt] });
  }
  return (
    <StepPanel title={c.title} intro={c.intro}>
      <YesNoToggle label={c.injuryOccurred} value={incident.injuryOccurred} onChange={v => upd({ injuryOccurred: v })} />
      {injured && (
        <>
          <div className="formSection">
            <span className="formSectionHeading">{c.injuredPartySectionTitle}</span>
            <div className="formGrid">
              <Field label={c.injuredPartyName} value={incident.injuredPartyName} onChange={v => upd({ injuredPartyName: v })} />
              <div className="formPairRow">
                <Field label="Title" value={incident.injuredPartyTitle} onChange={v => upd({ injuredPartyTitle: v })} />
                <Field label="Years with company" value={incident.injuredPartyYearsWithCompany} onChange={v => upd({ injuredPartyYearsWithCompany: v })} />
              </div>
              <Field label="Current trade" value={incident.injuredPartyCurrentTrade} onChange={v => upd({ injuredPartyCurrentTrade: v })} />
              <div className="formPairRow">
                <Field label={c.injuredPartyPhone} type="tel" value={incident.injuredPartyPhone} onChange={v => upd({ injuredPartyPhone: v })} />
                <Field label={c.injuredPartyEmail} type="email" value={incident.injuredPartyEmail} onChange={v => upd({ injuredPartyEmail: v })} />
              </div>
            </div>
          </div>

          <div className="field">
            <span>{c.natureOfInjury}</span>
            <div className="chipGrid">
              {INJURY_NATURE_OPTIONS.map(opt => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={(incident.injuryNature || []).includes(opt)}
                  aria-disabled={locked}
                  className={`chipToggle${(incident.injuryNature || []).includes(opt) ? ' active' : ''}`}
                  onClick={() => toggleNature(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          {(incident.injuryNature || []).includes('Other') && (
            <Field label={c.natureOfInjuryOther} value={incident.injuryNatureOther} onChange={v => upd({ injuryNatureOther: v })} />
          )}

          <Field label={c.bodyPartsAffectedText} value={incident.bodyPartsAffectedText} onChange={v => upd({ bodyPartsAffectedText: v })} />

          <div className="field">
            <span>{c.treatmentLevel}</span>
            <div className="yesNoToggle">
              <button type="button" aria-pressed={incident.treatmentLevel === 'firstAid'} aria-disabled={locked} className={`btn${incident.treatmentLevel === 'firstAid' ? ' active yes' : ''}`} onClick={() => { if (!locked) upd({ treatmentLevel: 'firstAid' }); }}>{c.treatmentFirstAid}</button>
              <button type="button" aria-pressed={incident.treatmentLevel === 'beyondFirstAid'} aria-disabled={locked} className={`btn${incident.treatmentLevel === 'beyondFirstAid' ? ' active no' : ''}`} onClick={() => { if (!locked) upd({ treatmentLevel: 'beyondFirstAid' }); }}>{c.treatmentBeyondFirstAid}</button>
            </div>
          </div>
          <Field label={c.treatingPhysicianOrClinic} value={incident.treatingPhysicianOrClinic} onChange={v => upd({ treatingPhysicianOrClinic: v })} />
          <TextAreaField label={c.injuryRemarks} rows={3} value={incident.injuryRemarks} onChange={v => upd({ injuryRemarks: v })} voice />

          <div className="field">
            <span>{c.bodyDiagramTitle}</span>
            <small>{c.bodyDiagramHelp}</small>
            <BodyDiagram marks={incident.bodyDiagramMarks || []} onChange={marks => upd({ bodyDiagramMarks: marks })} readOnly={locked} />
          </div>
        </>
      )}
      <StepFooter hasBack hasNext onBack={prev} onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Witnesses ── */
function StepWitnesses({ incident, upd, prev, next }) {
  const c = t.witnesses;
  const locked = useLocked();
  const witnesses = incident.witnesses || [];
  function addWitness() {
    if (locked || witnesses.length >= 3) return;
    upd({ witnesses: [...witnesses, emptyWitness()] });
  }
  function updWitness(id, patch) {
    upd({ witnesses: witnesses.map(w => (w.id === id ? { ...w, ...patch } : w)) });
  }
  function removeWitness(id) {
    if (locked) return;
    if (!window.confirm(t.confirmRemoveWitness)) return;
    upd({ witnesses: witnesses.filter(w => w.id !== id) });
  }
  return (
    <StepPanel title={c.title} intro={c.intro}>
      {witnesses.length === 0 && <p className="helperText">{c.empty}</p>}
      {witnesses.map((w, i) => (
        <div className="witnessCard" key={w.id}>
          <div className="cardRowHeader">
            <strong>Witness {i + 1}</strong>
            {!locked && <button type="button" className="btn ghost sm" onClick={() => removeWitness(w.id)}>{c.removeWitness}</button>}
          </div>
          <div className="formGrid">
            <div className="formPairRow">
              <Field label={c.name} value={w.name} onChange={v => updWitness(w.id, { name: v })} />
              <Field label={c.company} value={w.company} onChange={v => updWitness(w.id, { company: v })} />
            </div>
            <Field label={c.supervisor} value={w.supervisor} onChange={v => updWitness(w.id, { supervisor: v })} />
            <div className="formPairRow">
              <Field label={c.phone} type="tel" value={w.phone} onChange={v => updWitness(w.id, { phone: v })} />
              <Field label={c.email} type="email" value={w.email} onChange={v => updWitness(w.id, { email: v })} />
            </div>
          </div>
          <TextAreaField label={c.statement} rows={3} value={w.statement} onChange={v => updWitness(w.id, { statement: v })} voice />
          <div className="formPairRow">
            <SignaturePad label={c.signature} value={w.signatureData} onChange={data => updWitness(w.id, { signatureData: data, signatureDate: data ? new Date().toISOString().slice(0, 10) : w.signatureDate })} />
            <Field label={c.signatureDate} type="date" value={w.signatureDate} onChange={v => updWitness(w.id, { signatureDate: v })} />
          </div>
        </div>
      ))}
      {!locked && (witnesses.length < 3
        ? <button type="button" className="btn secondary" onClick={addWitness}>{c.addWitness}</button>
        : <p className="helperText">{c.maxReached}</p>)}
      <StepFooter hasBack hasNext onBack={prev} onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Property Damage ── */
function StepProperty({ incident, upd, prev, next }) {
  const c = t.property;
  const damaged = incident.propertyDamageOccurred === 'yes';
  return (
    <StepPanel title={c.title} intro={c.intro}>
      <YesNoToggle label={c.propertyDamageOccurred} value={incident.propertyDamageOccurred} onChange={v => upd({ propertyDamageOccurred: v })} />
      {damaged && (
        <div className="formGrid">
          <Field label={c.propertyOrMaterialDamaged} value={incident.propertyOrMaterialDamaged} onChange={v => upd({ propertyOrMaterialDamaged: v })} />
          <Field label={c.natureOfDamage} value={incident.natureOfDamage} onChange={v => upd({ natureOfDamage: v })} />
          <Field label={c.objectMachineToolOrSubstance} value={incident.objectMachineToolOrSubstance} onChange={v => upd({ objectMachineToolOrSubstance: v })} />
          <Field label={c.approximateDamageCost} value={incident.approximateDamageCost} onChange={v => upd({ approximateDamageCost: v })} />
        </div>
      )}
      <StepFooter hasBack hasNext onBack={prev} onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Cause Analysis ── */
function StepCause({ incident, upd, prev, next }) {
  const c = t.cause;
  const locked = useLocked();
  const selected = incident.selectedCauses || [];
  function toggle(key) {
    if (locked) return;
    if (selected.includes(key)) {
      const nextSelected = selected.filter(k => k !== key);
      upd({ selectedCauses: nextSelected, primaryCause: incident.primaryCause === key ? null : incident.primaryCause });
    } else {
      upd({ selectedCauses: [...selected, key] });
    }
  }
  function setPrimary(key) {
    if (locked) return;
    upd({ primaryCause: incident.primaryCause === key ? null : key });
  }
  return (
    <StepPanel title={c.title} intro={c.intro}>
      {CAUSE_CATEGORIES.map(cat => (
        <div className="causeCategoryBlock" key={cat.id}>
          <div className="causeCategoryTitle">{cat.label}</div>
          {cat.items.map(item => {
            const key = causeKey(cat.id, item);
            const checked = selected.includes(key);
            return (
              <div className="causeItemRow" key={key}>
                <label>
                  <input type="checkbox" checked={checked} onChange={() => toggle(key)} disabled={locked} />
                  <span>{item}</span>
                </label>
                {checked && (
                  <button type="button" aria-pressed={incident.primaryCause === key} aria-disabled={locked} className={`causePrimaryBtn${incident.primaryCause === key ? ' active' : ''}`} onClick={() => setPrimary(key)}>
                    {incident.primaryCause === key ? c.primaryBadge : c.setPrimary}
                  </button>
                )}
              </div>
            );
          })}
          {selected.includes(causeKey(cat.id, 'Other')) && (
            <Field label={c.otherLabel} value={incident[cat.otherField]} onChange={v => upd({ [cat.otherField]: v })} />
          )}
        </div>
      ))}
      {selected.length === 0 && <p className="helperText">{c.noneSelected}</p>}
      <StepFooter hasBack hasNext onBack={prev} onNext={next} />
    </StepPanel>
  );
}

/* ── Step: Notes & Investigation Team ── */
function StepNotes({ incident, upd, prev, next }) {
  const c = t.notes;
  const locked = useLocked();
  const team = incident.investigationTeam || [];
  function addMember() {
    if (locked || team.length >= 4) return;
    upd({ investigationTeam: [...team, emptyTeamMember()] });
  }
  function updMember(id, patch) {
    upd({ investigationTeam: team.map(m => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function removeMember(id) {
    if (locked) return;
    if (!window.confirm(t.confirmRemoveTeamMember)) return;
    upd({ investigationTeam: team.filter(m => m.id !== id) });
  }
  return (
    <StepPanel title={c.title}>
      <TextAreaField label={c.immediateActionsTitle} help={c.immediateActionsPrompt} rows={5} value={incident.immediateActionsTaken} onChange={v => upd({ immediateActionsTaken: v })} voice />
      <TextAreaField label={c.correctiveActionsTitle} help={c.correctiveActionsPrompt} rows={5} value={incident.correctivePreventiveActions} onChange={v => upd({ correctivePreventiveActions: v })} voice />
      <TextAreaField label={c.safetyConsultantNotes} rows={4} value={incident.safetyConsultantNotes} onChange={v => upd({ safetyConsultantNotes: v })} voice />

      <div className="formSection">
        <span className="formSectionHeading">{c.teamSectionTitle}</span>
        {team.length === 0 && <p className="helperText">{c.empty}</p>}
        {team.map((m, i) => (
          <div className="teamMemberCard" key={m.id}>
            <div className="cardRowHeader">
              <strong>Member {i + 1}</strong>
              {!locked && <button type="button" className="btn ghost sm" onClick={() => removeMember(m.id)}>{c.removeMember}</button>}
            </div>
            <div className="formPairRow">
              <Field label={c.memberName} value={m.name} onChange={v => updMember(m.id, { name: v })} />
              <Field label={c.memberTitle} value={m.title} onChange={v => updMember(m.id, { title: v })} />
            </div>
            <div className="formPairRow">
              <SignaturePad label={c.memberSignature} value={m.signatureData} onChange={data => updMember(m.id, { signatureData: data, date: data ? new Date().toISOString().slice(0, 10) : m.date })} />
              <Field label={c.memberDate} type="date" value={m.date} onChange={v => updMember(m.id, { date: v })} />
            </div>
          </div>
        ))}
        {!locked && (team.length < 4
          ? <button type="button" className="btn secondary" onClick={addMember}>{c.addMember}</button>
          : <p className="helperText">{c.maxReached}</p>)}
      </div>
      <StepFooter hasBack hasNext onBack={prev} onNext={next} nextLabel={t.nav.finish} />
    </StepPanel>
  );
}

/* ── Step: Review & Export ── */
function StepReview({ incident, prev, pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew, setStep }) {
  const c = t.review;
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const checks = getIncidentReadinessChecks(incident);
  const checklistComplete = isIncidentReady(incident);
  const isGenerating = pdfExportState?.phase === 'generating';
  const isReady = pdfExportState?.phase === 'ready';
  const status = incident.status;
  const headline = status === 'completed' ? c.completedHeadline : status === 'ready' ? c.readyHeadline : c.draftHeadline;
  return (
    <StepPanel title={c.title}>
      <div className="card">
        <div className="cardHeader">
          <strong>{c.readinessTitle}</strong>
          <p>{headline}</p>
        </div>
        {status === 'draft' && (
          <p className="helperText">
            {checklistComplete
              ? c.markReadyHint
              : `${checks.filter(k => !k.ok).length} ${checks.filter(k => !k.ok).length === 1 ? 'item' : 'items'} still needed — tap one to go straight to it.`}
          </p>
        )}
        <div className="incidentReadinessList">
          {checks.map(chk => (
            <button
              key={chk.key}
              type="button"
              className={`incidentReadinessItem ${chk.ok ? 'ok' : 'pending'}`}
              onClick={() => setStep(chk.step)}
              disabled={chk.ok || status !== 'draft'}
            >
              <span className="checkIcon">{chk.ok ? '\u2713' : '\u2022'}</span>
              <span>{chk.label}</span>
            </button>
          ))}
        </div>
        {status === 'draft' && (
          <div className="reviewInlineAction">
            <button className="btn secondary" onClick={() => setConfirmingFinish(true)} disabled={!checklistComplete}>{c.markReady}</button>
          </div>
        )}
        {status !== 'draft' && (
          <>
            <p className="helperText">Marked complete. Editing is locked while it's marked this way — creating or updating the PDF does not change this.</p>
            <div className="reviewInlineAction">
              <button className="btn secondary" onClick={onMarkIncomplete}>Mark Incomplete</button>
            </div>
          </>
        )}
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
            <button className="btn primary lg" onClick={onGeneratePdf} disabled={isGenerating} aria-busy={isGenerating}>
              {isGenerating ? c.generating : c.generatePdf}
            </button>
          </div>
        )}

        {isReady && isPdfStale && (
          <div className="pdfStaleWarning">
            <strong>Document changed &mdash; update it before downloading.</strong>
            <p>{c.stale}</p>
            <button className="btn primary sm" onClick={onGeneratePdf} disabled={isGenerating} aria-busy={isGenerating}>{c.regeneratePdf}</button>
          </div>
        )}

        {isReady && !isPdfStale && (
          <div className="pdfReadyPanel">
            <span className="pdfReadyEyebrow">Document Ready</span>
            <strong className="pdfReadyHeadline">{pdfExportState.pageCount} page{pdfExportState.pageCount === 1 ? '' : 's'}</strong>
            <p className="pdfReadyFilename">{pdfExportState.filename}</p>
            <div className="pdfReadyActions">
              <button className="btn primary lg" onClick={onDownload}>{c.download}</button>
            </div>
            <p className="helperText pdfReadyHelper">Download the document, then open it to print.</p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="cardHeader"><strong>Send to Someone Else to Finish</strong></div>
        <p className="helperText">Save a file you can text, email, or AirDrop to someone else. They can open it in this app and pick up right where you left off — the checklist above doesn't need to be done first.</p>
        <button type="button" className="btn secondary" onClick={() => downloadDraftFile('incident', incident, buildDraftFilename(incident.workplaceLocation, 'Incident Report', incident.incidentDate))}>Export Draft File</button>
      </div>

      <button type="button" className="btn ghost" onClick={onStartNew}>{c.startNew}</button>
      <StepFooter hasBack onBack={prev} />
    </StepPanel>
  );
}

/* ── Top-level workflow shell ── */
export default function IncidentWorkflow({
  incident, setIncident, step, setStep, goDocs, saveStatus, saveStatusState, onSaveNow,
  pdfExportState, isPdfStale, onGeneratePdf, onDownload, onMarkReady, onMarkIncomplete, onStartNew, showToast,
}) {
  const idx = INCIDENT_STEPS.findIndex(s => s.id === step);
  const isReviewStep = step === 'review';
  const shellRef = useRef(null);
  const shellWidth = useElementWidth(shellRef);
  const isTouchPrimary = useIsTouchPrimary();
  const showSideBySide = !isTouchPrimary && shellWidth >= 1000 && isReviewStep;
  const previewPanel = (
    <div className="card previewPanel">
      <div className="previewPanelHeader">
        <div>
          <strong>What Will Print</strong>
          <span>The real printed page, scaled to fit</span>
        </div>
      </div>
      <IncidentPreview incident={incident} />
    </div>
  );
  function upd(patch) {
    setIncident(prev => {
      const next = { ...prev, ...patch };
      // Editing any printed field after the report was marked ready/completed
      // returns it to draft (and clears completedAt) -- a "final" PDF must
      // never silently go stale without the user having to notice and
      // re-confirm readiness. Bookkeeping-only changes (e.g. lastSavedAt)
      // never reach upd(), so this only fires on genuine content edits.
      if (prev.status !== 'draft' && printedIncidentFingerprint(next) !== printedIncidentFingerprint(prev)) {
        next.status = 'draft';
        next.completedAt = '';
      }
      return next;
    });
  }
  function prev() { if (idx > 0) setStep(INCIDENT_STEPS[idx - 1].id); }
  function next() { if (idx < INCIDENT_STEPS.length - 1) setStep(INCIDENT_STEPS[idx + 1].id); }

  return (
    <>
      <div className="builderHeader">
        <div className="builderHeaderTitleRow">
          <div className="builderHeaderTitleBlock">
            <span className="builderHeaderKicker">{t.workflowTitle}</span>
            <h1 className="builderHeaderTitle">{incident.workplaceLocation || 'Untitled Incident Report'}</h1>
          </div>
          <button className="backBtn" onClick={goDocs}>&larr; Documents</button>
        </div>
        <div className="builderHeaderTop">
          <div className="builderHeaderBadges">
            <span className={`badge ${incident.status === 'draft' ? 'draft' : 'avail'}`}>
              {incident.status === 'draft' ? t.draftBadge : t.finishedBadge}
            </span>
            <span className={`builderHeaderSaved${saveStatusState === 'error' ? ' error' : ''}`}>{saveStatus}</span>
            <button type="button" className="btn ghost sm" onClick={onSaveNow} disabled={saveStatusState === 'saving'}>{t.saveNow}</button>
          </div>
        </div>
      </div>

      <LockedContext.Provider value={incident.status !== 'draft'}>
        <StepNav steps={INCIDENT_STEPS} activeStepId={step} checks={getIncidentReadinessChecks(incident)} onJump={setStep} />
        <div className={`workflowShell${showSideBySide ? ' withPreview' : ''}`} ref={shellRef}>
          <div className="workflowLeft">
            {step === 'details' && <StepDetails incident={incident} upd={upd} next={next} />}
            {step === 'injury' && <StepInjury incident={incident} upd={upd} prev={prev} next={next} />}
            {step === 'witnesses' && <StepWitnesses incident={incident} upd={upd} prev={prev} next={next} />}
            {step === 'property' && <StepProperty incident={incident} upd={upd} prev={prev} next={next} />}
            {step === 'cause' && <StepCause incident={incident} upd={upd} prev={prev} next={next} />}
            {step === 'notes' && <StepNotes incident={incident} upd={upd} prev={prev} next={next} />}
            {step === 'photos' && <IncidentPhotos incident={incident} upd={upd} showToast={showToast} prev={prev} next={next} />}
            {step === 'review' && (
              <StepReview
                incident={incident}
                prev={prev}
                pdfExportState={pdfExportState}
                isPdfStale={isPdfStale}
                onGeneratePdf={onGeneratePdf}
                onDownload={onDownload}
                onMarkReady={onMarkReady}
                onMarkIncomplete={onMarkIncomplete}
                onStartNew={onStartNew}
                setStep={setStep}
              />
            )}
            {!showSideBySide && isReviewStep && previewPanel}
          </div>
          {showSideBySide && (
            <div className="workflowRight">
              {previewPanel}
            </div>
          )}
        </div>
      </LockedContext.Provider>
    </>
  );
}
