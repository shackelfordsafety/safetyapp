import { useRef, useState } from 'react';
import { INCIDENT_PHOTO_CATEGORIES, emptyIncidentPhoto } from './incidentModel';
import { incidentCopy as t } from './incidentCopy';
import { processIncidentPhotoFile, findLikelyDuplicatePhoto } from './incidentPhotoProcessing';
import { savePhotoBlob, deletePhotoBlob } from './incidentPhotoStorage';
import { useIncidentPhotoUrls } from './useIncidentPhotoUrls';
import { useLocked } from '../documents/lockedContext';

/* ── Incident Photos step ──
   Field UX goal: tap photo -> take/select picture -> optionally label it ->
   done. Everything else (resize/compress, IndexedDB storage, object-URL
   lifecycle, PDF appendix pagination) happens underneath without the user
   ever seeing it -- see incidentPhotoProcessing.js / incidentPhotoStorage.js
   / useIncidentPhotoUrls.js / incidentPdfGenerate.jsx. */
export default function IncidentPhotos({ incident, upd, showToast, prev, next }) {
  const c = t.photos;
  const locked = useLocked();
  const photos = incident.photos || [];
  const photoUrls = useIncidentPhotoUrls(photos);
  const fileInputRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);

  function openPicker() {
    if (locked) return;
    fileInputRef.current?.click();
  }

  async function handleFiles(fileList) {
    // Defense in depth alongside openPicker()'s guard -- the file input
    // itself always stays in the DOM (only the visible "Add Photo" button
    // is hidden once locked), so a change event reaching it directly must
    // still be refused.
    if (locked) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setIsProcessing(true);
    // Each finished photo is appended with a FUNCTIONAL update against the
    // latest incident, never by writing back an array accumulated here: the
    // loop awaits between files, and anything the person does meanwhile
    // (remove a photo, type a caption) happened after that array was
    // copied. Writing it back used to resurrect a photo removed mid-batch
    // and wipe captions typed mid-batch. `seen` is only for in-batch
    // duplicate detection (the same file picked twice in one go).
    const seen = photos.slice();
    try {
      for (const file of files) {
        const duplicate = findLikelyDuplicatePhoto(seen, file);
        if (duplicate) {
          const proceed = window.confirm(`"${file.name}" looks like a photo you already added. Add it again anyway?`);
          if (!proceed) continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const { blob, width, height, mimeType } = await processIncidentPhotoFile(file);
          const meta = {
            ...emptyIncidentPhoto(),
            width,
            height,
            mimeType,
            sourceName: file.name,
            sourceSize: file.size,
          };
          // eslint-disable-next-line no-await-in-loop
          await savePhotoBlob(meta.id, incident.id, blob);
          seen.push(meta);
          upd(prev => ({ photos: [...(prev.photos || []), meta] }));
        } catch (err) {
          showToast?.(err?.message || `Couldn't add "${file.name}".`);
        }
      }
    } finally {
      setIsProcessing(false);
    }
  }

  function onInputChange(e) {
    const { files } = e.target;
    handleFiles(files);
    e.target.value = ''; // allow re-selecting the same file later
  }

  function removePhoto(photo) {
    if (locked) return;
    if (!window.confirm(c.confirmRemove)) return;
    deletePhotoBlob(photo.id).catch(() => { /* metadata removal below still proceeds */ });
    upd(prev => ({ photos: (prev.photos || []).filter(p => p.id !== photo.id) }));
  }

  function updatePhoto(id, patch) {
    if (locked) return;
    upd(prev => ({ photos: (prev.photos || []).map(p => (p.id === id ? { ...p, ...patch } : p)) }));
  }

  return (
    <div className="stepPanel">
      <div className="stepPanelHeader">
        <h3>{c.title}</h3>
        <p>{c.intro}</p>
      </div>
      <div className="incidentStepGrid">
        {/* No `capture` attribute on purpose -- it forces the OS straight into
            the camera app on iOS/Android, skipping the native chooser that
            also offers "Photo Library". Someone texted a photo to add, that
            photo's already in their library, not something the camera can
            take again (Fonzo, field report 2026-08-19). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onInputChange}
          className="incPhotoFileInput"
          aria-label={c.addPhoto}
        />
        {!locked && (
          <button type="button" className="btn primary lg incPhotoAddBtn" onClick={openPicker} disabled={isProcessing} aria-busy={isProcessing}>
            {isProcessing ? c.processing : c.addPhoto}
          </button>
        )}

        {photos.length === 0 && <p className="helperText">{c.empty}</p>}

        <div className="incPhotoCardList">
          {photos.map((photo) => {
            const entry = photoUrls[photo.id];
            return (
              <div className="incPhotoCard" key={photo.id}>
                <div className="incPhotoCardThumbWrap">
                  {entry?.status === 'ready' && entry.url
                    ? <img src={entry.url} alt={photo.caption || photo.category || 'Incident photo'} className="incPhotoCardThumb" />
                    : <div className="incPhotoCardThumbPlaceholder">{entry?.status === 'missing' || entry?.status === 'error' ? c.unavailable : c.loading}</div>}
                </div>
                <div className="incPhotoCardFields">
                  <label className="field">
                    <span>{c.category}</span>
                    <select value={photo.category || ''} onChange={e => updatePhoto(photo.id, { category: e.target.value })} disabled={locked}>
                      <option value="">{c.categoryNone}</option>
                      {INCIDENT_PHOTO_CATEGORIES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>{c.caption}</span>
                    <input
                      type="text"
                      value={photo.caption || ''}
                      placeholder={c.captionPlaceholder}
                      maxLength={220}
                      onChange={e => updatePhoto(photo.id, { caption: e.target.value })}
                      disabled={locked}
                    />
                  </label>
                  {!locked && (
                    <button type="button" className="btn ghost sm incPhotoRemoveBtn" onClick={() => removePhoto(photo)} aria-label={`${c.remove}`}>
                      {c.remove}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="stepFooter">
        <div className="leftBtns">
          {prev && <button className="btn ghost" onClick={prev}>{t.nav.back}</button>}
        </div>
        <div className="rightBtns">
          {next && <button className="btn primary" onClick={next}>{t.nav.finish}</button>}
        </div>
      </div>
    </div>
  );
}
