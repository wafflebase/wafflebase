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
  const doc = await DocxImporter.import(buffer, docsImageUploader);
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
  const blob = await DocxExporter.export(doc, docsImageFetcher);
  downloadBlob(blob, safeFilename(title, "docx"));
}
