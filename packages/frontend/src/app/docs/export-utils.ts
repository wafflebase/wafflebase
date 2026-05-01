import type { ImageFetcher, ImageUploader } from "@wafflebase/docs";
import { fetchWithAuth } from "@/api/auth";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/**
 * Resolve a possibly-relative image URL (e.g. "/images/<id>") against the
 * backend base URL so the browser can fetch it from a different origin /
 * port than the frontend.
 */
export function resolveImageUrl(url: string): string {
  // Preserve any absolute URL — http(s):, data:, blob:, file:, etc.
  // Only relative paths get prefixed with the backend base.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (!BACKEND_BASE) return url;
  return `${BACKEND_BASE.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * Uploads an image blob to the backend ImageModule and returns
 * the absolute URL the docs canvas can render. Used by both DOCX
 * import and any future direct image-insertion path.
 */
export const docsImageUploader: ImageUploader = async (
  blob: Blob,
  filename: string,
): Promise<string> => {
  const formData = new FormData();
  formData.append("file", blob, filename);
  const res = await fetchWithAuth(`${BACKEND_BASE}/images`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Image upload failed: ${res.status} ${res.statusText}`);
  }
  const { url } = (await res.json()) as { id: string; url: string };
  return resolveImageUrl(url);
};

/**
 * Downloads an image blob referenced by a docs image inline. Sends
 * cookies so backend-hosted (per-workspace) images are reachable.
 */
export const docsImageFetcher: ImageFetcher = async (
  url: string,
): Promise<Blob> => {
  const resolved = resolveImageUrl(url);
  // Use credentials so JWT cookies are sent for backend-hosted images.
  const res = await fetch(resolved, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.blob();
};

/**
 * Trigger a browser download for the given blob with the given filename.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Open a native file picker (single file). Resolves to the selected file
 * or null if the user cancels. The hidden input is appended to the DOM
 * so it works reliably across browsers.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let settled = false;

    input.onchange = () => {
      settled = true;
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    };

    // Detect cancel via window focus (no perfect way, but acceptable).
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    window.addEventListener("focus", onFocus);

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Build a filesystem-safe filename for export downloads.
 * Adds the extension if not already present.
 */
export function safeFilename(title: string, ext: "docx" | "pdf"): string {
  // Strip filesystem-unsafe characters; if nothing usable is left,
  // fall back to "document" so we don't return a hidden file like ".pdf".
  const sanitized = (title || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
  const safe = sanitized || "document";
  return safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
}
