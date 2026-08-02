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
