import { fetchWithAuth } from "@/api/auth";

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
 * Validates the file, loads dimensions, uploads to server.
 * Throws on validation or upload failure.
 */
export async function uploadImageFile(
  file: File,
  workspaceId: string,
): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File too large (max 10 MB)");
  }

  const { width, height } = await loadImageDimensions(file);

  const formData = new FormData();
  formData.append("file", file);

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

function resolveImageUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!BACKEND_BASE) return url;
  return `${BACKEND_BASE.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}
