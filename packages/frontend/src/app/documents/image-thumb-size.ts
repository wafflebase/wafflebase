/**
 * Largest original the list will download to draw its 16px thumbnail. There
 * are no server thumbnails, so a thumbnail costs the whole blob (uploads go
 * up to 25 MB); past this the row keeps the type icon instead. 2 MB still
 * covers a typical screenshot or web image.
 */
export const MAX_THUMB_SOURCE_BYTES = 2 * 1024 * 1024;

/** Whether a blob of this size is worth fetching for a thumbnail. Unknown
 *  (rows created before `fileSize` was recorded) counts as too large. */
export function canThumbnail(fileSize: number | null | undefined): boolean {
  return (
    typeof fileSize === "number" &&
    fileSize > 0 &&
    fileSize <= MAX_THUMB_SOURCE_BYTES
  );
}
