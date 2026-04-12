import type { EditorAPI } from "@wafflebase/docs";
import { docxImageUploader } from "./docx-actions";
import { toast } from "sonner";

/**
 * Upload an image file to the backend and return the absolute URL the
 * canvas can render. Reuses the same `/images` endpoint the DOCX
 * importer already uses, so auth (JWT cookie) and CORS wiring stay in
 * one place.
 */
export async function uploadImageFile(file: File): Promise<string> {
  const filename = file.name || "pasted-image";
  return docxImageUploader(file, filename);
}

/**
 * Preflight-load an image URL in a hidden <img> and resolve once the
 * browser knows its intrinsic dimensions. Needed because the editor's
 * `insertImage` wants pixel width/height at insert time so the layout
 * reserves the right amount of space from the first paint. Rejects on
 * network errors or an inaccessible URL.
 *
 * Intentionally does NOT set `crossOrigin` — that would force a CORS
 * preflight which most public image hosts (e.g. blogs, Wikipedia,
 * WordPress CDNs) don't support, and the request would fail before
 * we ever see the pixels. The docs canvas only uses `drawImage` on
 * inline pictures, so a cross-origin image becomes "tainted" for
 * `getImageData` / `toDataURL` (which we never call) but still
 * renders fine. Consistent with how `<img>` tags load cross-origin
 * images in a regular web page.
 */
export function loadImageDimensions(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error("Image has zero dimensions"));
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Upload a local image file, probe its natural size, and insert it at
 * the editor's current caret. Shows a toast on any failure. Wrapped
 * here so both the toolbar upload path and the drag/paste path go
 * through the same error-handling and insert flow.
 */
export async function insertImageFromFile(
  editor: EditorAPI,
  file: File,
): Promise<void> {
  try {
    const url = await uploadImageFile(file);
    const { width, height } = await loadImageDimensions(url);
    editor.insertImage(url, width, height, {
      originalWidth: width,
      originalHeight: height,
      alt: file.name,
    });
    editor.focus();
  } catch (err) {
    console.error("Image insert failed", err);
    toast.error(
      err instanceof Error
        ? `Image upload failed: ${err.message}`
        : "Image upload failed",
    );
  }
}

/**
 * Validate + insert an image URL typed by the user in the toolbar.
 * Unlike `insertImageFromFile`, this skips the upload step — the URL
 * is inserted as-is so external images (e.g. `https://...` referenced
 * from another host) do not get re-uploaded. The preflight load still
 * happens so we capture the natural dimensions and fail early on 404.
 *
 * Returns `true` on success so the caller can close the UI, or `false`
 * on validation / load failure so the caller can keep the input open
 * for the user to fix the URL instead of losing their typed text.
 *
 * NOTE: the URL is stored as a direct hotlink. Uploading external
 * images to first-party storage requires a backend endpoint
 * (`POST /images/from-url`) and is tracked as a Phase 2 follow-up.
 */
export async function insertImageFromUrl(
  editor: EditorAPI,
  url: string,
): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (!/^https?:\/\//i.test(trimmed)) {
    toast.error("Image URL must start with http:// or https://");
    return false;
  }
  try {
    const { width, height } = await loadImageDimensions(trimmed);
    editor.insertImage(trimmed, width, height, {
      originalWidth: width,
      originalHeight: height,
    });
    editor.focus();
    return true;
  } catch (err) {
    console.error("Image URL insert failed", err);
    toast.error(
      err instanceof Error
        ? `Couldn't load image: ${err.message}`
        : "Couldn't load image",
    );
    return false;
  }
}
