import type { UploadKind } from "./upload-kind";

const UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * Human-readable byte size for the documents list and the file card. Returns
 * an em dash for documents predating the `fileSize` column, which is why the
 * argument is optional rather than the callers each guarding.
 */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Mirrors the backend caps in packages/backend/src/file/file.constants.ts. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Why this file cannot be uploaded, or undefined if it can.
 *
 * Checked at enqueue time so an over-cap file never goes over the wire — the
 * backend would reject it anyway, but only after the whole body was sent.
 * That was tolerable when uploads were capped-by-construction to a handful of
 * document formats; with arbitrary files accepted, a multi-gigabyte video
 * would otherwise be uploaded in full before failing.
 */
export function uploadSizeError(
  kind: UploadKind,
  bytes: number,
): string | undefined {
  const cap = kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (bytes <= cap) return undefined;
  return `File is larger than the ${cap / 1024 / 1024} MB limit`;
}
