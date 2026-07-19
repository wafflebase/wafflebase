import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/** Upload a blob (pdf or image); returns the stored blob id. */
export async function uploadFile(file: File): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(`${BACKEND_BASE}/files`, {
    method: "POST",
    body: formData,
  });
  await assertOk(res, "File upload failed");
  return (await res.json()) as { id: string };
}

/** Document-scoped, permission-gated URL that streams the stored blob. */
export function fileUrl(documentId: string, token?: string): string {
  const base = `${BACKEND_BASE}/documents/${documentId}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
