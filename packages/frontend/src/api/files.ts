import { fetchWithAuth } from "./auth";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/** Upload a PDF blob; returns the stored blob id. */
export async function uploadPdf(file: File): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(`${BACKEND_BASE}/files`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`PDF upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { id: string };
}

/** Document-scoped, permission-gated URL that streams the stored PDF. */
export function pdfFileUrl(documentId: string, token?: string): string {
  const base = `${BACKEND_BASE}/documents/${documentId}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
