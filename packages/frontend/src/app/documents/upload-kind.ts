/**
 * What a queued row produces. Every other kind is classified from a file
 * extension; `board` is deliberately absent from `EXT_TO_KIND` because no
 * file maps to it. It exists because an externally driven row
 * (`enqueueExternal` — today the Miro import) still has to say what it is
 * making, so consumers that switch on the kind can tell an import apart from
 * an upload.
 */
export type UploadKind =
  | "sheet"
  | "doc"
  | "slides"
  | "pdf"
  | "image"
  | "board";

export const SKIP_REASON = "Unsupported file type";

const EXT_TO_KIND: Record<string, UploadKind> = {
  xlsx: "sheet",
  csv: "sheet",
  // Tab-separated files go through the same importer: papaparse guesses the
  // delimiter (tab is in its default set), so `.tsv` needs no parser of its own.
  tsv: "sheet",
  docx: "doc",
  pptx: "slides",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
};

export function classifyUploadKind(fileName: string): UploadKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? null;
}

/**
 * Above this, a CSV/TSV upload is parsed by the backend instead of the browser.
 * Bytes, not rows: the row count is unknown until something parses the file.
 * XLSX is never routed — it has no backend parser (see `upload-queue`).
 *
 * This is a *memory* threshold, not a speed one. Parsing is never the slow
 * part: papaparse reads 7.2 MB in ~175 ms, and the largest file that can
 * actually materialize into a Yorkie document parses in ~13 ms. What it does
 * cost is heap — measured at roughly **7x the file size** once the string and
 * the parsed rows are both live:
 *
 *   |  4 MB →  36 MB  |  15 MB → 138 MB  |  37 MB → 341 MB  |  75 MB → ~700 MB
 *
 * plus a hard wall: V8 caps a string at ~512 MB, so a file past that cannot be
 * read by `File.text()` at all. 25 MB keeps a tab under ~175 MB — safe on
 * phones — and everything above it goes to the server not because that is
 * faster but because the browser has nowhere to put it.
 */
export const CLIENT_PARSE_MAX_BYTES = 25 * 1024 * 1024;
