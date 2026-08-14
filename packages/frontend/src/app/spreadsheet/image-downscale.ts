/**
 * Client-side downscaling for images that exceed the upload limit.
 *
 * An image over the limit is almost always a photo or a screenshot taken at
 * device-pixel density, and rejecting it forces the user out of the app to
 * resize it somewhere else. Shrinking it here keeps the paste/drop flow in one
 * step (issue #815).
 *
 * This module never decides whether a file is acceptable — it returns the
 * smallest version it managed to produce (or the original, if it could not
 * produce one at all) and `uploadImageFile` re-checks the size. Keeping the
 * limit in one place is what makes the "still too large" error honest.
 */

/** Longest side of the downscaled image, before the scale steps below. */
const MAX_DIMENSION = 4096;

/**
 * Tried in order until an encode lands under the limit. The first step is a
 * plain re-encode at the capped dimensions: a 12 MB PNG screenshot usually
 * fits once it is WebP, with no pixels lost at all.
 */
const SCALE_STEPS = [1, 0.7, 0.5, 0.35, 0.25];

const QUALITY = 0.85;

/**
 * MIME types a canvas re-encode would damage. A GIF drawn to a canvas keeps
 * its first frame only, so downscaling an animation silently destroys it —
 * better to report the size and let the user decide.
 */
const NEVER_DOWNSCALE = new Set(["image/gif"]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * A decoded image the codec can draw. `ImageBitmap` satisfies this; tests
 * substitute a plain object.
 */
export type DecodedImage = {
  width: number;
  height: number;
  close?: () => void;
};

/**
 * Decode/encode pair, injectable because jsdom has neither
 * `createImageBitmap` nor a real 2D context. Production callers use the
 * browser implementation below and never pass this.
 */
export type ImageCodec = {
  decode: (file: File) => Promise<DecodedImage>;
  encode: (
    image: DecodedImage,
    width: number,
    height: number,
    type: string,
    quality: number,
  ) => Promise<Blob | null>;
};

const browserCodec: ImageCodec = {
  // `from-image` because a phone photo carries its rotation in EXIF: an `<img>`
  // honours it, but a bitmap drawn to a canvas would bake in the unrotated
  // pixels and the image would come back sideways after downscaling.
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  encode: (image, width, height, type, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  },
};

/**
 * Return a version of `file` at or under `maxBytes`, or the smallest version
 * this could produce when even the last scale step overshoots.
 *
 * Returns the original file untouched when it already fits, when its type
 * cannot survive a re-encode, or when the browser fails to decode or encode
 * it. Never throws: a failure to downscale is reported by the caller as the
 * size error it was already going to be.
 */
export async function downscaleImageFile(
  file: File,
  maxBytes: number,
  codec: ImageCodec = browserCodec,
): Promise<File> {
  if (file.size <= maxBytes) return file;
  if (NEVER_DOWNSCALE.has(file.type)) return file;

  let image: DecodedImage;
  try {
    image = await codec.decode(file);
  } catch {
    return file;
  }

  try {
    // WebP keeps the alpha channel a PNG source may carry; a JPEG source gains
    // nothing from a second lossy codec, so it stays JPEG.
    const targetType = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const cap = Math.min(
      1,
      MAX_DIMENSION / Math.max(image.width, image.height, 1),
    );

    let best = file;
    for (const step of SCALE_STEPS) {
      const width = Math.max(1, Math.round(image.width * cap * step));
      const height = Math.max(1, Math.round(image.height * cap * step));

      let blob: Blob | null;
      try {
        blob = await codec.encode(image, width, height, targetType, QUALITY);
      } catch {
        return best;
      }
      if (!blob) return best;

      if (blob.size < best.size) best = toFile(blob, file.name, targetType);
      if (best.size <= maxBytes) return best;
    }
    return best;
  } finally {
    image.close?.();
  }
}

/**
 * Wrap an encoded blob as a File, with the extension the encoded bytes
 * actually are. `toBlob` falls back to PNG when it cannot honour the
 * requested type, so the blob's own type wins over the one we asked for —
 * otherwise the backend would store PNG bytes under a `.webp` key and serve
 * them with the wrong `Content-Type`.
 */
function toFile(blob: Blob, name: string, requestedType: string): File {
  const type = MIME_TO_EXT[blob.type] ? blob.type : requestedType;
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return new File([blob], `${base}.${MIME_TO_EXT[type] ?? "webp"}`, { type });
}
