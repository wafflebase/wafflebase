import { fetchWithAuth } from "./auth";
import { fileUrl } from "./files";

/**
 * Fallback extension by blob MIME type, used when a document's stored `fileId`
 * (which carries the original extension) isn't available on the caller — e.g.
 * the documents list, whose projection omits it. Covers the blob types the app
 * accepts (pdf + the image formats).
 */
const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Build the saved-file name: keep the document title and ensure it ends with
 * the file's extension (from `fileId` first, then the blob MIME type). Returns
 * the bare title when no extension can be determined.
 */
export function downloadFileName(
  title: string,
  fileId?: string,
  mime?: string,
): string {
  const ext =
    fileId?.split(".").pop()?.toLowerCase() ||
    (mime ? MIME_EXT[mime] : undefined);
  if (!ext) return title;
  return title.toLowerCase().endsWith(`.${ext}`) ? title : `${title}.${ext}`;
}

/**
 * Fetch a document's stored blob through the authed, permission-gated file
 * endpoint and trigger a browser download. Throws on a non-OK response so the
 * caller can surface an error.
 */
export async function downloadDocumentFile(doc: {
  id: string;
  title: string;
  fileId?: string;
}): Promise<void> {
  const res = await fetchWithAuth(fileUrl(doc.id));
  if (!res.ok) throw new Error(`Failed to download (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadFileName(doc.title, doc.fileId, blob.type);
  a.click();
  // Revoke on a delay: revoking synchronously after click() can cancel the
  // download before the browser has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
