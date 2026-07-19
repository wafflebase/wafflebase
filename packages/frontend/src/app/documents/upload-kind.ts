export type UploadKind = "sheet" | "doc" | "slides" | "pdf" | "image";

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
