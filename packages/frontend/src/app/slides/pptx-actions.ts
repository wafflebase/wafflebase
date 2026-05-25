import {
  importPptx,
  type ImportReport,
  type SlidesDocument,
  type UploadImage,
} from "@wafflebase/slides";
import { docsImageUploader } from "../docs/export-utils";
import { pickFile } from "../docs/export-utils";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

/**
 * Bridge the slides importer's bytes+mime signature onto the shared
 * /images upload endpoint, which expects a `Blob` + filename. Reuses
 * `docsImageUploader` so PPTX images land in the same workspace bucket
 * as DOCX images.
 */
const slidesImageUploader: UploadImage = async (
  bytes: Uint8Array,
  mime: string,
): Promise<string> => {
  const ext = MIME_TO_EXT[mime] ?? "bin";
  const blob = new Blob([bytes], { type: mime });
  return docsImageUploader(blob, `image.${ext}`);
};

/**
 * Open the file picker for .pptx and parse the chosen archive. Returns
 * `null` if the user cancels. Throws on a malformed archive or a
 * failed image upload — the caller surfaces a toast and aborts the
 * document-creation flow.
 */
export async function pickAndImportPptx(
  onProgress?: (p: {
    done: number;
    total: number;
    fileName: string;
  }) => void,
): Promise<{
  document: SlidesDocument;
  report: ImportReport;
  fileName: string;
} | null> {
  const file = await pickFile(".pptx");
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  const { document, report } = await importPptx(buffer, {
    uploadImage: slidesImageUploader,
    onProgress: onProgress
      ? (done, total) => onProgress({ done, total, fileName: file.name })
      : undefined,
  });
  return { document, report, fileName: file.name };
}
