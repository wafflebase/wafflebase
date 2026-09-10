import type { EditorAPI } from "@wafflebase/docs";
import { docxImageUploader } from "./docx-actions";
import { resolveImageUrl } from "./export-utils";
import { postShareTokenImage } from "@/api/images";
import { toast } from "sonner";

/**
 * Upload one image file and return the absolute URL the canvas can render.
 *
 * Which route that goes through depends on who is asking, so it is a
 * parameter rather than a constant: {@link uploadImageFile} is the
 * authenticated owner path, {@link shareTokenImageUploader} the anonymous
 * share-link one.
 */
export type DocsImageUpload = (file: File) => Promise<string>;

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
 * The uploader for a visitor whose only authority is an **editor** share
 * token. Goes to the workspace image spine — the backend derives the
 * workspace from the token, so nothing here names one — and the result is read
 * back through the gated route, which is why a shared docs mount also installs
 * `setImageUrlResolver` (`shared-document.tsx`). Without the resolver the
 * image would 403 for every reader including the author.
 *
 * The token is *not* written into the stored URL: that URL lives in the CRDT
 * and is shared with every other viewer plus the author, so it is tokened
 * per-viewer at render time instead.
 */
export function shareTokenImageUploader(token: string): DocsImageUpload {
  return async (file: File): Promise<string> => {
    const { url } = await postShareTokenImage(
      file,
      token,
      file.name || "pasted-image",
    );
    return resolveImageUrl(url);
  };
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
 * Measure a local image file's intrinsic size from a `blob:` URL, without
 * touching the network.
 *
 * Probing the *uploaded* URL instead cannot work on the share-link path: that
 * URL is workspace-scoped and readable only with the visitor's `?token=`
 * appended, which the stored URL deliberately does not carry — so a plain
 * `<img>` on it is a 403, and the insert would fail after a successful
 * upload. The bytes are the same either way (nothing here downscales), so the
 * local measurement is the same number one round trip earlier. Mirrors what
 * `spreadsheet/image-upload.ts` already does for the other engines.
 */
function loadFileDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error("Image has zero dimensions"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image"));
    };
    img.src = url;
  });
}

/**
 * Upload a local image file, probe its natural size, and insert it at
 * the editor's current caret. Shows a toast on any failure. Wrapped
 * here so both the toolbar upload path and the drag/paste path go
 * through the same error-handling and insert flow.
 *
 * `upload` defaults to the authenticated owner path; a shared-link mount
 * passes {@link shareTokenImageUploader} instead. The size is read off the
 * local file rather than the uploaded URL — see {@link loadFileDimensions}.
 *
 * The upload is a network round trip, so the editor this resumes on may no
 * longer be the mounted one: a `/shared/:token` session whose role drops
 * `editor` → `viewer` mid-flight rebuilds the editor read-only and disposes
 * this one. `readOnly` is baked in at construction, so the captured instance
 * cannot be downgraded in place — {@link EditorAPI.dispose} neuters its
 * mutators instead, and {@link EditorAPI.isDisposed} is how this path tells
 * a neutered no-op from a write that landed.
 */
export async function insertImageFromFile(
  editor: EditorAPI,
  file: File,
  position?: { blockId: string; offset: number },
  upload: DocsImageUpload = uploadImageFile,
): Promise<void> {
  try {
    const { width, height } = await loadFileDimensions(file);
    const url = await upload(file);
    if (editor.isDisposed()) {
      toast.error("Image not inserted: this document is no longer editable");
      return;
    }
    editor.insertImage(url, width, height, {
      originalWidth: width,
      originalHeight: height,
      alt: file.name,
      position,
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
    // Same stale-editor check as `insertImageFromFile`: the preflight load
    // is a network round trip, and the role can drop under it.
    if (editor.isDisposed()) {
      toast.error("Image not inserted: this document is no longer editable");
      return false;
    }
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
