/**
 * Pattern matching Yorkie operation paths that require cross-sheet formula
 * recalculation: cell data, merge definitions, and tab name changes.
 */
const cellChangePattern =
  /^\$\.sheets\.[^.]+\.(cells|merges)|^\$\.tabs\.[^.]+\.name/;

/**
 * Determine whether a set of remote-change operations includes changes that
 * require cross-sheet formula recalculation.
 *
 * Cell/merge/tab-name changes need recalc + render; everything else (styles,
 * dimensions, charts, filters, etc.) only needs reload + render.
 *
 * When operations are missing (`undefined`), we conservatively assume recalc
 * is needed.
 */
export function needsRecalc(
  operations: Array<{ path?: string }> | undefined,
): boolean {
  if (!operations) return true;
  return operations.some(
    (op) => op.path != null && cellChangePattern.test(op.path),
  );
}
