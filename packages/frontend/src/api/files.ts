import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import { seg } from "./url";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/** Upload a blob; returns the stored blob id plus its recorded metadata. */
export async function uploadFile(
  file: File,
): Promise<{ id: string; size: number; mimeType: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(`${BACKEND_BASE}/files`, {
    method: "POST",
    body: formData,
  });
  await assertOk(res, "File upload failed");
  return (await res.json()) as { id: string; size: number; mimeType: string };
}

/** Document-scoped, permission-gated URL that streams the stored blob. */
export function fileUrl(documentId: string, token?: string): string {
  const base = `${BACKEND_BASE}/documents/${seg(documentId)}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
