/* Client-side incident photo ingestion: decode -> orient -> resize ->
   compress -> plain JPEG blob, before anything ever reaches IndexedDB or a
   generated PDF.

   Modern phone cameras routinely produce 3-12MP (often 4000px+ on the long
   edge) JPEGs/HEIC-via-browser-conversion in the tens of megabytes across a
   handful of photos. Storing those untouched would risk IndexedDB quota
   problems, slow autosave-adjacent reads, and a bloated/slow-to-generate
   PDF -- none of which serves the actual goal (a legible photo of an
   incident scene, printed roughly 3.5in tall, two to a page). Chosen limits:

     MAX_DIMENSION_PX = 1600 -- long-edge cap. At the appendix's printed
       frame size (~3.5-4in tall), 1600px is well above the ~300dpi a
       sharp print needs (300dpi * 4in = 1200px), so nothing perceptibly
       softens on the page; it's also plenty for a superintendent to pinch-
       zoom on a phone/tablet screen before export. Photos already smaller
       than this are never upscaled.
     JPEG_QUALITY = 0.82 -- visually indistinguishable from source at this
       resolution for photographic content, while keeping typical output in
       the low hundreds of KB per photo instead of several MB.

   Every incident photo is normalized to JPEG regardless of source format
   (JPEG, PNG, etc.) -- one predictable format simplifies both storage and
   the PDF embed path (pdf-lib's embedJpg), and photographic incident-scene
   content has no need for PNG's transparency/lossless properties. */

export const MAX_DIMENSION_PX = 1600;
export const JPEG_QUALITY = 0.82;

/* Best-effort image decode that respects EXIF orientation, so a phone photo
   taken in portrait never comes out sideways in the thumbnail or the PDF.
   createImageBitmap's `imageOrientation: 'from-image'` is the standards
   path (Chrome, Safari/iOS, Firefox all support it); HTMLImageElement is a
   safe fallback for anything that doesn't support createImageBitmap at all
   -- modern browsers auto-apply EXIF orientation there too (CSS Images'
   image-orientation defaults to from-image), so the fallback still renders
   right-side-up, it just costs an extra decode round-trip via a data URL. */
async function decodeOriented(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to the <img> fallback below (e.g. a format
      // createImageBitmap can't handle in this browser).
    }
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the photo file.'));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be opened as an image.'));
    img.src = dataUrl;
  });
}

function sourceDimensions(source) {
  // HTMLImageElement uses naturalWidth/Height; ImageBitmap uses width/height.
  return {
    width: source.naturalWidth ?? source.width,
    height: source.naturalHeight ?? source.height,
  };
}

/* Resizes/compresses one image File into a normalized JPEG blob. Throws a
   plain-language Error on any failure (unsupported file, decode failure,
   canvas/export failure) -- callers (IncidentPhotos.jsx) catch this and
   show it directly to the field user, never a raw stack trace. */
export async function processIncidentPhotoFile(file) {
  if (!file) throw new Error("That file isn't a photo. Choose a JPEG or PNG image.");
  // Only a type that is known AND not an image is refused up front. Some
  // pickers (iOS Files, Android downloads, extension-less files) hand over
  // a real photo with an empty or generic "application/octet-stream" type;
  // decoding below is the real test.
  const type = String(file.type || '').toLowerCase();
  if (type && type !== 'application/octet-stream' && !type.startsWith('image/')) {
    throw new Error(`"${file.name || 'That file'}" isn't a photo. Choose a JPEG or PNG image.`);
  }

  let source;
  try {
    source = await decodeOriented(file);
  } catch (err) {
    throw new Error(err?.message || `Couldn't open "${file.name}" as a photo.`);
  }

  const { width: rawWidth, height: rawHeight } = sourceDimensions(source);
  if (!rawWidth || !rawHeight) {
    throw new Error(`"${file.name}" doesn't look like a valid photo.`);
  }

  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(rawWidth, rawHeight));
  const width = Math.max(1, Math.round(rawWidth * scale));
  const height = Math.max(1, Math.round(rawHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process photos.');
  // Flatten onto white first -- source PNGs may carry transparency, and the
  // normalized output is always opaque JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close(); // release ImageBitmap memory promptly

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error(`Couldn't process "${file.name}". Try a different photo.`))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });

  return { blob, width, height, mimeType: 'image/jpeg' };
}

/* Reasonable, non-annoying duplicate protection: flags a newly-picked file
   as a likely duplicate only when both its name AND size exactly match a
   photo already on this report. A photo genuinely retaken/re-exported with
   the same filename but a different size (or vice versa) is NOT flagged --
   false positives are worse than an occasional missed duplicate for a field
   user who just wants to keep documenting. Callers should confirm with the
   user rather than silently blocking the add. */
export function findLikelyDuplicatePhoto(existingPhotos, file) {
  if (!file) return null;
  return (existingPhotos || []).find(p => p.sourceName === file.name && p.sourceSize === file.size) || null;
}
