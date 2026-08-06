/**
 * What a queued row produces — the document type the file becomes.
 *
 * `file` is the fallback for every extension without a richer handler: a blob
 * document with no dedicated viewer. It is a rule, not a stopgap — see
 * docs/design/generic-file-upload.md on `Document.type` as a viewer-routing
 * key. `board` is deliberately absent from `EXT_TO_KIND` because no file maps
 * to it; it exists for externally driven rows (`enqueueExternal`, today the
 * Miro import).
 */
export type UploadKind =
  | "sheet"
  | "doc"
  | "slides"
  | "pdf"
  | "image"
  | "board"
  | "file";

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

export function classifyUploadKind(fileName: string): UploadKind {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "file";
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? "file";
}
