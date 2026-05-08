const MARKER_SIZE = 9;
const MARKER_COLOR = '#fbbc04';

/**
 * Draws a 7x7 yellow right-triangle comment marker at the top-right corner of a cell.
 * The triangle is positioned with its right angle at the top-right corner.
 *
 * @param ctx - Canvas rendering context
 * @param cellRight - X coordinate of the right edge of the cell
 * @param cellTop - Y coordinate of the top edge of the cell
 */
export function drawCommentMarker(
  ctx: CanvasRenderingContext2D,
  cellRight: number,
  cellTop: number,
): void {
  ctx.fillStyle = MARKER_COLOR;
  ctx.beginPath();
  // Start at the top-right corner
  ctx.moveTo(cellRight, cellTop);
  // Draw down along the right edge
  ctx.lineTo(cellRight, cellTop + MARKER_SIZE);
  // Draw left along the top edge
  ctx.lineTo(cellRight - MARKER_SIZE, cellTop);
  ctx.closePath();
  ctx.fill();
}

/**
 * Build a per-cell key set (`${rowId}|${colId}`) from the open threads
 * so the renderer can do an O(1) check per cell.
 *
 * Only threads with `resolved: false` and `anchor.kind: 'sheet-cell'` are included.
 * This filters out resolved threads and non-cell anchors (if any).
 *
 * @param threads - Array of comment threads to scan
 * @returns Set of cell keys in format `${rowId}|${colId}`
 */
export function buildOpenThreadKeySet(
  threads: ReadonlyArray<{
    anchor: { kind: string; rowId?: string; colId?: string };
    resolved: boolean;
  }>,
): Set<string> {
  const keys = new Set<string>();
  for (const t of threads) {
    // Skip resolved threads
    if (t.resolved) continue;
    // Skip non-cell anchors
    if (t.anchor.kind !== 'sheet-cell') continue;
    // rowId and colId should be present for sheet-cell anchors, but be defensive
    if (!t.anchor.rowId || !t.anchor.colId) continue;
    keys.add(`${t.anchor.rowId}|${t.anchor.colId}`);
  }
  return keys;
}
