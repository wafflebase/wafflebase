/**
 * A sheet title from an imported file's name: the name without its
 * extension, or `fallback` when nothing is left. Kept apart from
 * `sheet-import-actions` so callers that only need the title (the upload
 * queue) do not load the sheets engine to get it.
 */
export function sheetImportBaseName(
  fileName: string,
  fallback = "Imported Sheet",
): string {
  const dot = fileName.lastIndexOf(".");
  const baseName = (dot >= 0 ? fileName.slice(0, dot) : fileName).trim();
  return baseName || fallback;
}
