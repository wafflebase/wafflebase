import {
  DEFAULT_CELL_PADDING,
  isBlocksEmpty,
  type CellBorder,
  type TableCell,
  type TableElement,
} from '../../model/element';
import type { Theme } from '../../model/theme';
import { resolveStrokeColor } from './render-context';
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
  const { columnWidths, rows } = data;
  const nCols = columnWidths.length;
  const nRows = rows.length;
  if (nCols === 0 || nRows === 0) return;

  // Column x-offsets at every column boundary (length nCols + 1).
  const colX: number[] = new Array(nCols + 1);
  colX[0] = 0;
  for (let c = 0; c < nCols; c++) colX[c + 1] = colX[c] + columnWidths[c];

  // Row heights with content auto-grow.
  //
  // Pass A — unmerged cells. Each row's height is
  // `max(declared, max contentHeight across non-covered rowSpan=1
  // cells in this row)`. Mirrors OOXML `<a:tr h>` ("minimum") semantics.
  //
  // Pass B — merged anchors (rowSpan > 1). If the anchor's content
  // height exceeds the SUM of its covered rows (Pass A heights), the
  // deficit is added to the LAST row of the merge so the anchor cell's
  // painted height always equals the rendered content height. Matches
  // PowerPoint's "tall merged headline pushes its last row down"
  // behavior; the alternative (clip overflow to declared span) would
  // truncate visible text.
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

  // void unused size param for now — kept on signature for parity with
  // drawText/drawShape and so a future overflow-clamp path can clip.
  void size;

  paintCellFills(ctx, rows, nCols, colX, rowY, theme);
  paintCellContents(ctx, rows, nCols, colX, rowY, theme, options);
  paintCellBorders(ctx, rows, nCols, colX, rowY, theme);
}

function paintCellFills(
  ctx: CanvasRenderingContext2D,
  rows: Data['rows'],
  nCols: number,
  colX: number[],
  rowY: number[],
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
  colX: number[],
  rowY: number[],
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
  colX: number[],
  rowY: number[],
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
      ctx.setLineDash(dashPattern(edge.stroke.dash));
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

function dashPattern(dash: CellBorder['dash']): number[] {
  if (dash === 'dashed') return [6, 4];
  if (dash === 'dotted') return [2, 2];
  return [];
}

function isCovered(cell: TableCell): boolean {
  return cell.gridSpan === 0 || cell.rowSpan === 0;
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

