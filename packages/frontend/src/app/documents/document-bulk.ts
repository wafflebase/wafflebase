/**
 * Bulk-selection helpers for the documents list: a custom-MIME drag payload
 * (kept disjoint from the `useWindowFileDrop` OS-file drop, which keys on the
 * `"Files"` type) and a whole-selection permission check.
 */

export const DOC_DRAG_MIME = "application/x-wafflebase-docs";

/** Write the dragged document ids onto the drag event's dataTransfer. */
export function encodeDocDrag(dt: DataTransfer, ids: string[]): void {
  dt.setData(DOC_DRAG_MIME, JSON.stringify(ids));
  dt.effectAllowed = "move";
}

/** Read document ids from a drop, or null if this isn't a document drag. */
export function decodeDocDrag(dt: DataTransfer): string[] | null {
  const raw = dt.getData(DOC_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a drag currently in flight is a document drag. Uses `types` (the
 * only thing readable during `dragover`, when `getData` is blocked).
 */
export function isDocDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(DOC_DRAG_MIME);
}

/** True iff `ids` is non-empty and every id maps to a manageable document. */
export function allManageable(
  ids: string[],
  docs: Array<{ id: string; canManage: boolean }>,
): boolean {
  if (ids.length === 0) return false;
  const byId = new Map(docs.map((d) => [d.id, d]));
  return ids.every((id) => byId.get(id)?.canManage === true);
}
