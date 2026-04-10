import {
  DocxImporter,
  DocxExporter,
  type Document as DocsDocument,
  type ImageUploader,
  type ImageFetcher,
} from "@wafflebase/docs";
import { fetchWithAuth } from "@/api/auth";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/**
 * Resolve a possibly-relative image URL (e.g. "/images/<id>") against the
 * backend base URL so the browser can fetch it from a different origin /
 * port than the frontend.
 */
function resolveImageUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!BACKEND_BASE) return url;
  return `${BACKEND_BASE.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * Image uploader passed into DocxImporter — uploads each embedded image
 * found inside a .docx file to the backend ImageModule and returns an
 * absolute URL the docs canvas can render.
 */
export const docxImageUploader: ImageUploader = async (
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
 * Image fetcher passed into DocxExporter — downloads images referenced by
 * the document so they can be embedded into the .docx zip.
 */
export const docxImageFetcher: ImageFetcher = async (
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
 * Open a native file picker for .docx files and parse the selected file
 * into a Docs `Document`. Returns `null` if the user cancels the picker.
 */
export async function pickAndImportDocx(): Promise<{
  doc: DocsDocument;
  fileName: string;
} | null> {
  const file = await pickFile(".docx");
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  const doc = await DocxImporter.import(buffer, docxImageUploader);
  return { doc, fileName: file.name };
}

/**
 * Export the given Document as a .docx file and trigger a browser
 * download.
 */
export async function exportDocxAndDownload(
  doc: DocsDocument,
  title: string,
): Promise<void> {
  const blob = await DocxExporter.export(doc, docxImageFetcher);
  const safeTitle = (title || "document").replace(/[\\/:*?"<>|]+/g, "_").trim();
  const filename = safeTitle.toLowerCase().endsWith(".docx")
    ? safeTitle
    : `${safeTitle}.docx`;

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
 * Open a native file picker and resolve to the selected file (or null
 * if the user cancels). The hidden input is appended to the DOM so it
 * works reliably across browsers.
 */
function pickFile(accept: string): Promise<File | null> {
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
