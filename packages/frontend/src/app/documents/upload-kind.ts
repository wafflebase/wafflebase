export type UploadKind = "sheet" | "doc" | "slides" | "pdf";

export const SKIP_REASON = "Unsupported file type";

/** Accept string for the multi-select file picker covering every supported kind. */
export const UPLOAD_ACCEPT = ".xlsx,.docx,.pptx,.pdf";

const EXT_TO_KIND: Record<string, UploadKind> = {
  xlsx: "sheet",
  docx: "doc",
  pptx: "slides",
  pdf: "pdf",
};

export function classifyUploadKind(fileName: string): UploadKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? null;
}
