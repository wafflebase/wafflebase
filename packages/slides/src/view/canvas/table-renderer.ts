import {
  DEFAULT_CELL_PADDING,
  isBlocksEmpty,
  type CellBorder,
  type TableCell,
  type TableElement,
} from '../../model/element';
import type { Theme } from '../../model/theme';
import { dashArray, resolveStrokeColor } from './render-context';
import type { FrameSize } from './shapes/builder';
import { measureTextBodyHeight, paintTextBody } from './text-renderer';

type Data = TableElement['data'];

type Span = { row: number; col: number; rowSpan: number; gridSpan: number };

/**
 * Draw a table element into element-local coordinates (top-left at 0,0).
 * Mirrors `drawText` / `drawShape` — the frame transform belongs to the
 * element-renderer; this function only knows about `(w, h)` and the
 * table data.
 *
 * Painting passes:
 *   1. cell fills (skip covered cells, account for gridSpan / rowSpan)
 *   2. cell text bodies (paintTextBody with cell padding + verticalAlign)
 *   3. cell borders (per side; dominant stroke wins on shared edges —
 *      OOXML border-collapse: thicker first, then darker)
 *
 * The renderer is intentionally read-only — no selection overlays, no
 * resize handles. Editing affordances are added in later P-phases.
 */
export function drawTable(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: Data,
  theme: Theme,
  options?: { fontScale?: number },
): void {
  const { rows } = data;
  const nCols = data.columnWidths.length;
  if (nCols === 0 || rows.length === 0) return;

  const { colX, rowY } = computeTableLayout(data, options);

  // void unused size param for now — kept on signature for parity with
  // drawText/drawShape and so a future overflow-clamp path can clip.
  void size;

  paintCellFills(ctx, rows, nCols, colX, rowY, theme);
  paintCellContents(ctx, rows, nCols, colX, rowY, theme, options);
  paintCellBorders(ctx, rows, nCols, colX, rowY, theme);
}

export interface TableLayout {
  /** Column x-offsets at every column boundary; length = nCols + 1. */
  readonly colX: readonly number[];
  /** Row y-offsets at every row boundary; length = nRows + 1. */
  readonly rowY: readonly number[];
  /** Final per-row heights after auto-grow + merge redistribution. */
  readonly rowH: readonly number[];
}

/**
 * Compute the column / row offsets and final row heights of a table.
 *
 * Auto-grow is two passes (matches `drawTable`'s prior inline logic):
 *  - Pass A (unmerged): each row grows to fit the tallest rowSpan=1
 *    cell content, with declared `row.height` as the floor (OOXML
 *    `<a:tr h>` "minimum" semantics).
 *  - Pass B (merged anchors): when a rowSpan>1 cell's content exceeds
 *    the sum of its covered rows, the deficit is added to the LAST row
 *    of the merge. Matches PowerPoint's "tall merged headline pushes
 *    its last row down" behavior; the alternative (clip overflow to
 *    declared span) would truncate visible text.
 *
 * Pure: depends only on the table data + the docs `measureTextBodyHeight`
 * helper, no canvas / DOM / theme access. Safe to call from the editor
 * (cell hit-test, cell text-edit mount frame) and from future PDF
 * export.
 */
export function computeTableLayout(
  data: Data,
  options?: { fontScale?: number },
): TableLayout {
  const { columnWidths, rows } = data;
  const nCols = columnWidths.length;
  const nRows = rows.length;

  const colX: number[] = new Array(nCols + 1);
  colX[0] = 0;
  for (let c = 0; c < nCols; c++) colX[c + 1] = colX[c] + columnWidths[c];

  const measureOpts = { fontScale: options?.fontScale };
  const rowH: number[] = new Array(nRows);
  for (let r = 0; r < nRows; r++) {
    let maxContent = 0;
    const row = rows[r];
    for (let c = 0; c < nCols; c++) {
      const cell = row.cells[c];
      if (!cell || isCovered(cell)) continue;
      const rspan = Math.max(cell.rowSpan ?? 1, 1);
      if (rspan !== 1) continue;
      const gspan = Math.min(Math.max(cell.gridSpan ?? 1, 1), nCols - c);
      const cellW = colX[c + gspan] - colX[c];
      const pad = paddingOf(cell);
      const innerW = Math.max(0, cellW - pad.left - pad.right);
      const contentH =
        measureTextBodyHeight(cell.body, innerW, measureOpts)
        + pad.top + pad.bottom;
      if (contentH > maxContent) maxContent = contentH;
    }
    rowH[r] = Math.max(row.height, maxContent);
  }
  for (let r = 0; r < nRows; r++) {
    const row = rows[r];
    for (let c = 0; c < nCols; c++) {
      const cell = row.cells[c];
      if (!cell || isCovered(cell)) continue;
      const rspan = Math.min(Math.max(cell.rowSpan ?? 1, 1), nRows - r);
      if (rspan === 1) continue;
      const gspan = Math.min(Math.max(cell.gridSpan ?? 1, 1), nCols - c);
      const cellW = colX[c + gspan] - colX[c];
      const pad = paddingOf(cell);
      const innerW = Math.max(0, cellW - pad.left - pad.right);
      const contentH =
        measureTextBodyHeight(cell.body, innerW, measureOpts)
        + pad.top + pad.bottom;
      let spanH = 0;
      for (let i = 0; i < rspan; i++) spanH += rowH[r + i];
      if (contentH > spanH) rowH[r + rspan - 1] += contentH - spanH;
    }
  }
  const rowY: number[] = new Array(nRows + 1);
  rowY[0] = 0;
  for (let r = 0; r < nRows; r++) rowY[r + 1] = rowY[r] + rowH[r];

  return { colX, rowY, rowH };
}

function paintCellFills(
  ctx: CanvasRenderingContext2D,
  rows: Data['rows'],
  nCols: number,
  colX: readonly number[],
  rowY: readonly number[],
  theme: Theme,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < nCols; c++) {
      const cell = row.cells[c];
      if (!cell || isCovered(cell)) continue;
      if (cell.style.fill === undefined) continue;
      const span = spanOf(cell, r, c, rows.length, nCols);
      const x = colX[span.col];
      const y = rowY[span.row];
      const w = colX[span.col + span.gridSpan] - x;
      const h = rowY[span.row + span.rowSpan] - y;
      ctx.fillStyle = resolveStrokeColor(cell.style.fill, theme);
      ctx.fillRect(x, y, w, h);
    }
  }
}

function paintCellContents(
  ctx: CanvasRenderingContext2D,
  rows: Data['rows'],
  nCols: number,
  colX: readonly number[],
  rowY: readonly number[],
  theme: Theme,
  options: { fontScale?: number } | undefined,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < nCols; c++) {
      const cell = row.cells[c];
      if (!cell || isCovered(cell)) continue;
      if (isBlocksEmpty(cell.body.blocks)) continue;

      const span = spanOf(cell, r, c, rows.length, nCols);
      const x = colX[span.col];
      const y = rowY[span.row];
      const w = colX[span.col + span.gridSpan] - x;
      const h = rowY[span.row + span.rowSpan] - y;

      const pad = paddingOf(cell);
      const innerW = Math.max(0, w - pad.left - pad.right);
      const innerH = Math.max(0, h - pad.top - pad.bottom);

      ctx.save();
      ctx.translate(x + pad.left, y + pad.top);
      // Tables grow rows, not text. The row-height pass already grew
      // the row to fit the un-shrunken content height, so paint never
      // needs to shrink — but pinning autofit to 'none' here makes the
      // policy explicit and prevents a future PPTX importer from
      // accidentally re-introducing a measure-vs-paint divergence by
      // forwarding `<a:normAutofit/>` straight onto cell bodies.
      //
      // The cell-level vertical-align default routes through
      // paintTextBody's `defaultVerticalAnchor` opt so the body's own
      // `verticalAnchor` (when set) still wins, matching how
      // shape-renderer wires the same precedence.
      paintTextBody(
        ctx,
        { w: innerW, h: innerH },
        { ...cell.body, autofit: 'none' },
        theme,
        {
          fontScale: options?.fontScale,
          defaultVerticalAnchor: cell.style.verticalAlign,
        },
      );
      ctx.restore();
    }
  }
}

function paintCellBorders(
  ctx: CanvasRenderingContext2D,
  rows: Data['rows'],
  nCols: number,
  colX: readonly number[],
  rowY: readonly number[],
  theme: Theme,
): void {
  type Edge = {
    axis: 'h' | 'v';
    a: number; // segment start
    b: number; // segment end
    p: number; // perpendicular position (y for 'h', x for 'v')
    stroke: CellBorder;
  };
  const horizontal = new Map<string, Edge>();
  const vertical = new Map<string, Edge>();

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < nCols; c++) {
      const cell = row.cells[c];
      if (!cell || isCovered(cell)) continue;
      const span = spanOf(cell, r, c, rows.length, nCols);
      const x0 = colX[span.col];
      const x1 = colX[span.col + span.gridSpan];
      const y0 = rowY[span.row];
      const y1 = rowY[span.row + span.rowSpan];

      const top = cell.style.border?.top;
      const bottom = cell.style.border?.bottom;
      const left = cell.style.border?.left;
      const right = cell.style.border?.right;

      if (top) registerEdge(horizontal, 'h', x0, x1, y0, top, theme);
      if (bottom) registerEdge(horizontal, 'h', x0, x1, y1, bottom, theme);
      if (left) registerEdge(vertical, 'v', y0, y1, x0, left, theme);
      if (right) registerEdge(vertical, 'v', y0, y1, x1, right, theme);
    }
  }

  const drawSegments = (edges: Map<string, Edge>) => {
    for (const edge of edges.values()) {
      ctx.strokeStyle = resolveStrokeColor(edge.stroke.color, theme);
      ctx.lineWidth = edge.stroke.width;
      ctx.setLineDash(dashArray(edge.stroke.dash));
      ctx.beginPath();
      if (edge.axis === 'h') {
        ctx.moveTo(edge.a, edge.p);
        ctx.lineTo(edge.b, edge.p);
      } else {
        ctx.moveTo(edge.p, edge.a);
        ctx.lineTo(edge.p, edge.b);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };

  drawSegments(horizontal);
  drawSegments(vertical);
}

function registerEdge(
  map: Map<string, { axis: 'h' | 'v'; a: number; b: number; p: number; stroke: CellBorder }>,
  axis: 'h' | 'v',
  a: number,
  b: number,
  p: number,
  stroke: CellBorder,
  theme: Theme,
): void {
  const key = edgeKey(axis, a, b, p);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { axis, a, b, p, stroke });
    return;
  }
  const dominant = dominantBorder(prev.stroke, stroke, theme);
  if (dominant !== prev.stroke) {
    map.set(key, { axis, a, b, p, stroke: dominant });
  }
}

function edgeKey(axis: 'h' | 'v', a: number, b: number, p: number): string {
  // Adjacent cells derive their shared edge from the same `colX[]`
  // prefix sum (or `rowY[]`), so coincident coordinates are bit-equal.
  // Exact equality is sufficient in P1; if a future phase introduces
  // sub-pixel drag-resize, add a tolerance pinned by a regression test.
  return `${axis}|${a}|${b}|${p}`;
}

/**
 * OOXML border-collapse: thicker first, then darker. Ties stay with `a`
 * (the first-registered border, which is the cell at the smaller row /
 * column index in our scan order — matches PowerPoint's convention).
 *
 * `theme` is threaded so role-bound `ThemeColor` borders resolve to a
 * concrete hex before the luminance comparison — otherwise every
 * theme-colored border tied at the 0.5 fallback and the "darker wins"
 * branch silently degraded to first-registered.
 */
function dominantBorder(a: CellBorder, b: CellBorder, theme: Theme): CellBorder {
  if (a.width !== b.width) return a.width > b.width ? a : b;
  const la = luminance(a.color, theme);
  const lb = luminance(b.color, theme);
  if (la !== lb) return la < lb ? a : b;
  return a;
}

function luminance(color: CellBorder['color'], theme: Theme): number {
  // Resolve role-bound colors to concrete hex through the deck theme so
  // imported PPTX borders (which routinely use {kind:'role'} encodings)
  // compare by their painted darkness, not by the type-discriminator.
  const hex = resolveStrokeColor(color, theme);
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex);
  if (!m) return 0.5;
  const h =
    m[1].length === 3
      ? m[1].split('').map((c) => c + c).join('')
      : m[1];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isCovered(cell: TableCell): boolean {
  return cell.gridSpan === 0 || cell.rowSpan === 0;
}

/**
 * Pointer hit-test in element-local table coordinates. Given a logical
 * `(localX, localY)` measured from the table's top-left corner and the
 * pre-computed `TableLayout`, return `{row, col}` of the anchor cell the
 * pointer lands on, or `null` when the point falls outside the table's
 * painted bounds.
 *
 * Hits on merge-covered cells (`gridSpan === 0 || rowSpan === 0`) snap
 * to the anchor cell whose declared span covers the (r, c) coordinate.
 * Both axis-only and 2D merges resolve correctly — there is no special
 * casing for "horizontal-only" vs "vertical-only" coverage.
 *
 * Used by the editor's dblclick → enter-cell-edit path so the docs text
 * bridge mounts on the anchor's rect rather than on the visually-empty
 * covered region.
 */
export function tableCellAtPoint(
  data: Data,
  layout: TableLayout,
  localX: number,
  localY: number,
): { row: number; col: number } | null {
  const r = findIndex(layout.rowY, localY);
  const c = findIndex(layout.colX, localX);
  if (r < 0 || c < 0) return null;
  return resolveAnchor(data, r, c);
}

/**
 * Largest index `i` in `[0..boundaries.length - 2]` such that
 * `boundaries[i] <= v < boundaries[i+1]`, or `-1` when `v` is out of
 * the half-open range `[boundaries[0], boundaries.at(-1)!)`.
 */
function findIndex(boundaries: readonly number[], v: number): number {
  if (boundaries.length < 2) return -1;
  if (v < boundaries[0]) return -1;
  if (v >= boundaries[boundaries.length - 1]) return -1;
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (v < boundaries[i + 1]) return i;
  }
  return -1;
}

/**
 * Pointer-near-border hit-test. Given element-local pointer coords and
 * the table's pre-computed `TableLayout`, return the column or row
 * boundary the pointer is near (within `tolerance` px). Excludes the
 * outermost boundaries (table edges) — those are part of the outer
 * element's resize handles, not the column/row drag affordance.
 *
 * Used by the editor's drag-resize gesture: hover sets the
 * col-resize / row-resize cursor; pointerdown arms the gesture.
 */
export function tableEdgeAt(
  layout: TableLayout,
  localX: number,
  localY: number,
  tolerance: number,
): { kind: 'col' | 'row'; index: number; position: number } | null {
  const colCount = layout.colX.length - 1;
  const rowCount = layout.rowY.length - 1;
  const tableW = layout.colX[colCount];
  const tableH = layout.rowY[rowCount];
  // Column boundaries — interior only (index 1..colCount - 1). The
  // pointer must be inside the table's y range so brushing past the
  // table on the left / right doesn't false-positive.
  if (localY >= 0 && localY <= tableH) {
    for (let i = 1; i < colCount; i++) {
      const x = layout.colX[i];
      if (Math.abs(localX - x) <= tolerance) {
        return { kind: 'col', index: i, position: x };
      }
    }
  }
  if (localX >= 0 && localX <= tableW) {
    for (let i = 1; i < rowCount; i++) {
      const y = layout.rowY[i];
      if (Math.abs(localY - y) <= tolerance) {
        return { kind: 'row', index: i, position: y };
      }
    }
  }
  return null;
}

/**
 * Step one cell in `direction` (+1 = forward, -1 = backward), wrapping
 * across row boundaries (`(r, nCols-1) → (r+1, 0)` forward / mirror
 * backward). Covered cells (`gridSpan === 0 || rowSpan === 0`) are
 * skipped — the loop keeps stepping in the same direction until it
 * lands on a non-covered cell or falls off the table.
 *
 * Returns `null` when stepping past the last (resp. first) cell in
 * the table — the caller decides whether to bounce, append a new row,
 * or no-op. P3 uses the bounce behaviour; P4 will inject an
 * `appendRow + enter(r+1, 0)` here.
 *
 * Used by the cell-edit Tab / Shift+Tab navigation: `enterEditMode`
 * commits the current cell and re-enters at the returned coordinate.
 */
export function nextCellInDirection(
  data: Data,
  row: number,
  col: number,
  direction: 1 | -1,
): { row: number; col: number } | null {
  const nCols = data.columnWidths.length;
  const nRows = data.rows.length;
  let r = row;
  let c = col;
  while (true) {
    if (direction === 1) {
      c++;
      if (c >= nCols) {
        c = 0;
        r++;
        if (r >= nRows) return null;
      }
    } else {
      c--;
      if (c < 0) {
        c = nCols - 1;
        r--;
        if (r < 0) return null;
      }
    }
    const cell = data.rows[r]?.cells[c];
    if (cell && !isCovered(cell)) return { row: r, col: c };
    // Otherwise keep stepping in `direction` until we land on a
    // non-covered cell or fall off the table.
  }
}

function resolveAnchor(
  data: Data,
  r: number,
  c: number,
): { row: number; col: number } {
  const cell = data.rows[r]?.cells[c];
  if (cell && !isCovered(cell)) return { row: r, col: c };
  // Linear scan: at most one anchor's declared span covers (r, c) for
  // valid OOXML data, so we return the first that matches. Tables are
  // typically <= ~10 rows × ~10 cols, so O(r*c) is fine for the editor
  // dblclick path.
  for (let r2 = 0; r2 <= r; r2++) {
    const row = data.rows[r2];
    if (!row) continue;
    for (let c2 = 0; c2 <= c; c2++) {
      const candidate = row.cells[c2];
      if (!candidate || isCovered(candidate)) continue;
      const gs = candidate.gridSpan ?? 1;
      const rs = candidate.rowSpan ?? 1;
      if (c2 + gs > c && r2 + rs > r) {
        return { row: r2, col: c2 };
      }
    }
  }
  // Unreachable for valid data (every covered cell has an anchor in
  // scan order before it); fall back to the literal hit to avoid crashing
  // the caller on malformed input.
  return { row: r, col: c };
}

function spanOf(
  cell: TableCell,
  row: number,
  col: number,
  nRows: number,
  nCols: number,
): Span {
  const gridSpan = Math.min(Math.max(cell.gridSpan ?? 1, 1), nCols - col);
  const rowSpan = Math.min(Math.max(cell.rowSpan ?? 1, 1), nRows - row);
  return { row, col, gridSpan, rowSpan };
}

function paddingOf(cell: TableCell): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const p = cell.style.padding;
  return {
    top: p?.top ?? DEFAULT_CELL_PADDING.top,
    right: p?.right ?? DEFAULT_CELL_PADDING.right,
    bottom: p?.bottom ?? DEFAULT_CELL_PADDING.bottom,
    left: p?.left ?? DEFAULT_CELL_PADDING.left,
  };
}

