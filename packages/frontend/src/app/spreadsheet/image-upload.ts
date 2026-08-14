import { fetchWithAuth } from "@/api/auth";
import { downscaleImageFile } from "./image-downscale";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export type UploadResult = {
  id: string;
  url: string;
  width: number;
  height: number;
};

/**
 * Validates the file, downscales it if it is over the size limit, loads
 * dimensions, uploads to server. Throws on validation or upload failure.
 *
 * An oversized image is shrunk rather than refused — resizing is the common
 * case and should not need a round trip through an image editor (issue #815).
 * The dimensions returned are those of the bytes actually uploaded, not of the
 * original.
 */
export async function uploadImageFile(
  file: File,
  workspaceId: string,
): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}`);
  }

  const upload =
    file.size > MAX_FILE_SIZE
      ? await downscaleImageFile(file, MAX_FILE_SIZE)
      : file;
  if (upload.size > MAX_FILE_SIZE) {
    throw new Error(tooLargeMessage(file, upload));
  }

  const { width, height } = await loadImageDimensions(upload);

  const formData = new FormData();
  formData.append("file", upload);

  const res = await fetchWithAuth(
    `${BACKEND_BASE}/api/v1/workspaces/${workspaceId}/images`,
    { method: "POST", body: formData },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed: ${body}`);
  }

  const { id, url } = (await res.json()) as { id: string; url: string };
  return { id, url: resolveImageUrl(url), width, height };
}

/**
 * Explain a rejection in the terms the user can act on: how big their image
 * is, what the limit is, and — when downscaling ran and still came up short —
 * that it was already tried. A bare "File too large (max 10 MB)" leaves them
 * guessing whether they missed by 200 KB or by 40 MB.
 */
function tooLargeMessage(original: File, downscaled: File): string {
  const limit = formatBytes(MAX_FILE_SIZE);
  if (downscaled === original) {
    return `Image is ${formatBytes(original.size)}, over the ${limit} limit`;
  }
  return (
    `Image is still ${formatBytes(downscaled.size)} after downscaling ` +
    `(was ${formatBytes(original.size)}), over the ${limit} limit`
  );
}

/**
 * Rounds *up*, so a file a hair over the cap never reads as the cap itself —
 * "Image is 10 MB, over the 10 MB limit" explains nothing. One decimal, but
 * "10 MB" rather than "10.0 MB": rounding a 12.5 MB image to "13 MB" would be
 * the same kind of unhelpful the old message was.
 */
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(Math.ceil(mb * 10) / 10).toFixed(1).replace(/\.0$/, "")} MB`;
}

function loadImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error("Image has zero dimensions"));
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/**
 * Turn a backend image URL into one the browser can actually load.
 *
 * The backend hands out image URLs root-relative (`/api/v1/workspaces/...`),
 * but the SPA and the API sit on different origins in every environment we
 * ship (`VITE_BACKEND_API_URL` is `http://localhost:3000` in dev and
 * `https://api.wafflebase.io` in prod), so a relative URL resolves against the
 * SPA origin and 404s forever once it is persisted. Anything already absolute
 * is left alone.
 *
 * Exported because EVERY path that writes a backend image URL into a CRDT
 * document has to apply this, not just the native upload above. The Miro board
 * import is the second such path, and it shipped storing the raw relative URL
 * precisely because this rule was private to this module.
 */
export function resolveImageUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!BACKEND_BASE) return url;
  return `${BACKEND_BASE.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}
