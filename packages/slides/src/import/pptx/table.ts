import type { Element as SlideElement, Frame, ShapeElement, TextElement } from '../../model/element';
import { generateId } from '../../model/element';
import { parseColorFromContainer } from './color';
import { parseXfrm } from './geometry';
import type { SlideParseContext } from './shape';
import { parseTextBody } from './text';
import { attr, attrInt, child, children, descendant } from './xml';

/**
 * Flatten `<p:graphicFrame><a:tbl>` into a matrix of TextElements (one
 * per cell) overlaid on a borderless rect per cell to carry the cell's
 * stroke. Cells with `<a:gridSpan>` / `<a:rowSpan>` are reported but
 * not specially merged in v1 — the benchmark deck has zero merges, and
 * a true merge requires `colSpan/rowSpan` semantics that our generic
 * shape rect can't express. Merge placeholders (`<a:hMerge>` /
 * `<a:vMerge>`) are simply dropped.
 *
 * Returns an array of slide elements in painting order:
 *   - first: cell border rect (so text paints on top)
 *   - then: cell text body
 */
export function parseTable(
  graphicFrame: Element,
  ctx: SlideParseContext,
): SlideElement[] {
  const xfrm = child(graphicFrame, 'xfrm');
  const tableFrame = parseXfrm(xfrm, ctx.scale);

  const tbl = descendant(graphicFrame, 'tbl');
  if (!tbl) return [];

  const gridCols = children(child(tbl, 'tblGrid') ?? tbl, 'gridCol');
  const colWidthsPx = gridCols.map((g) => (attrInt(g, 'w') ?? 0) * ctx.scale.sx);

  const rows = children(tbl, 'tr');
  const rowHeightsPx = rows.map((r) => (attrInt(r, 'h') ?? 0) * ctx.scale.sy);

  const out: SlideElement[] = [];

  let y = tableFrame.y;
  for (let r = 0; r < rows.length; r++) {
    const rowEl = rows[r];
    const rowHeight = rowHeightsPx[r] || 0;
    let x = tableFrame.x;
    const cells = children(rowEl, 'tc');
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const colWidth = colWidthsPx[c] || 0;

      // Track merge artifacts; we don't honor them but counting tells
      // the user when a deck would benefit from real table support.
      if (attr(cell, 'hMerge') || attr(cell, 'vMerge')) {
        ctx.report.tableMergesIgnored += 1;
        x += colWidth;
        continue;
      }
      const colSpan = attrInt(cell, 'gridSpan');
      const rowSpan = attrInt(cell, 'rowSpan');
      if ((colSpan && colSpan > 1) || (rowSpan && rowSpan > 1)) {
        ctx.report.tableMergesIgnored += 1;
      }

      const cellFrame: Frame = {
        x,
        y,
        w: colWidth * (colSpan ?? 1),
        h: rowHeight * (rowSpan ?? 1),
        rotation: 0,
      };

      const border = buildCellBorder(cellFrame, cell, ctx);
      if (border) out.push(border);

      const txBody = child(cell, 'txBody');
      if (txBody) {
        const txt: TextElement = {
          id: generateId(),
          type: 'text',
          frame: cellFrame,
          data: { blocks: parseTextBody(txBody, { rels: ctx.rels, report: ctx.report }) },
        };
        out.push(txt);
      }

      x += colWidth;
    }
    y += rowHeight;
  }

  ctx.report.tablesFlattened += 1;
  return out;
}

/**
 * Synthesise a single transparent rect with the dominant cell border as
 * its stroke. PPTX cells expose four separate borders (`lnL`/`lnR`/
 * `lnT`/`lnB`), but our `ShapeStroke` is uniform per element. Pick the
 * first border with a real color and report the approximation.
 */
function buildCellBorder(
  frame: Frame,
  cell: Element,
  ctx: SlideParseContext,
): ShapeElement | undefined {
  const tcPr = child(cell, 'tcPr');
  if (!tcPr) return undefined;
  for (const tag of ['lnL', 'lnR', 'lnT', 'lnB'] as const) {
    const ln = child(tcPr, tag);
    if (!ln) continue;
    const solid = child(ln, 'solidFill');
    if (!solid) continue;
    const color = parseColorFromContainer(solid);
    if (!color) continue;
    // EMU width → px width (~9525 EMU = 1 px at 96 dpi).
    const wEmu = attrInt(ln, 'w');
    const width = wEmu != null ? Math.max(0, wEmu / 9525) : 1;
    // Bump approximation counter once per cell, not per border.
    ctx.report.tableBordersApproximated += 1;
    return {
      id: generateId(),
      type: 'shape',
      frame,
      data: {
        kind: 'rect',
        stroke: { color, width },
      },
    };
  }
  return undefined;
}
