import {
  DocxImporter,
  DocxExporter,
  type Document as DocsDocument,
} from "@wafflebase/docs";
import {
  docsImageUploader,
  docsImageFetcher,
  downloadBlob,
  pickFile,
  safeFilename,
} from "./export-utils";

// Back-compat aliases for any external consumers that still import the
// docx-prefixed names.
export const docxImageUploader = docsImageUploader;
export const docxImageFetcher = docsImageFetcher;

/**
 * Parse an already-selected .docx `File` into a Docs `Document`. Used
 * directly by the upload queue and internally by `pickAndImportDocx`.
 */
export async function importDocx(
  file: File,
  onProgress?: (p: {
    done: number;
    total: number;
    fileName: string;
  }) => void,
): Promise<{ doc: DocsDocument; fileName: string }> {
  const buffer = await file.arrayBuffer();
  const doc = await DocxImporter.import(
    buffer,
    docsImageUploader,
    onProgress
      ? (done, total) => onProgress({ done, total, fileName: file.name })
      : undefined,
  );
  return { doc, fileName: file.name };
}

/**
 * Open a native file picker for .docx files and parse the selected file
 * into a Docs `Document`. Returns `null` if the user cancels the picker.
 */
export async function pickAndImportDocx(
  onProgress?: (p: {
    done: number;
    total: number;
    fileName: string;
  }) => void,
): Promise<{
  doc: DocsDocument;
  fileName: string;
} | null> {
  const file = await pickFile(".docx");
  if (!file) return null;
  return importDocx(file, onProgress);
}

/**
 * Export the given Document as a .docx file and trigger a browser
 * download.
 */
export async function exportDocxAndDownload(
  doc: DocsDocument,
  title: string,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<void> {
  const blob = await DocxExporter.export(doc, docsImageFetcher, onProgress);
  downloadBlob(blob, safeFilename(title, "docx"));
}
