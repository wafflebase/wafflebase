import {
  exportPptx,
  importPptx,
  type ImportReport,
  type SlidesDocument,
  type UploadImage,
} from "@wafflebase/slides";
import {
  docsImageFetcher,
  docsImageUploader,
  downloadBlob,
  pickFile,
  safeFilename,
} from "../docs/export-utils";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

/**
 * Export the presentation to a `.pptx` archive and trigger a browser
 * download.
 *
 * Unlike the PDF path, PPTX is vector DrawingML XML — there is no canvas
 * raster step, so fonts need no preloading; PowerPoint resolves the family
 * names at open time. Images are embedded as `ppt/media/` parts: `exportPptx`
 * asks for each unique image `src`'s bytes through `fetchImage`, which we
 * satisfy with the same credentialed `docsImageFetcher` used by the docs and
 * slides PDF exporters (backend images are same-origin-fetched with cookies).
 *
 * `exportPptx` is re-exported from the browser entry of `@wafflebase/slides`
 * and is DOM-free, so it is safe to call from the editor. `onProgress` is
 * forwarded to the per-slide progress callback so the caller can drive an
 * export toast, mirroring the PDF path.
 */
export async function exportSlidesPptxAndDownload(
  doc: SlidesDocument,
  title: string,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<void> {
  const bytes = await exportPptx(doc, {
    fetchImage: async (src) => {
      const blob = await docsImageFetcher(src);
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type || "image/png",
      };
    },
    onProgress,
  });
  const blob = new Blob([bytes], { type: PPTX_MIME });
  downloadBlob(blob, safeFilename(title, "pptx"));
}
