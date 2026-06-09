import type {
  CellBorder,
  CellStyle,
  Element as SlideElement,
  TableCell,
  TableElement,
  TableRow,
  VerticalAnchorMode,
} from '../../model/element';
import { generateId } from '../../model/element';
import type { ThemeColor } from '../../model/theme';
import { parseColorFromContainer } from './color';
import { emuToStrokePx, parseXfrm } from './geometry';
import type { SlideParseContext } from './shape';
import { detectVerticalAnchor, parseTextBody } from './text';
import { attr, attrInt, child, children, descendant } from './xml';

/**
 * Parse a `<p:graphicFrame>/<a:tbl>` into a single structured
 * `TableElement`. Returned as a one-item `SlideElement[]` so `parseSpTree`
 * can splice the result into the slide's elements list alongside the
 * other shape kinds.
 *
 * Returns an empty list when the frame holds something other than a
 * table (e.g. `<a:graphicData uri=".../diagram">`) so the parent
 * dispatcher can continue without special-casing.
 *
 * **Encoding contract** (consumed by the renderer and by store ops):
 *  - `gridSpan`/`rowSpan` > 1 lives on the merge anchor.
 *  - PPTX covered cells encoded as `<a:tc hMerge="1">` / `<a:tc vMerge="1">`
 *    map to `gridSpan: 0` / `rowSpan: 0` on the covered cell so renderer
 *    and store ops can short-circuit via `isCovered`.
 *  - `<a:tableStyleId>` is preserved verbatim for PPTX round-trip; v1
 *    bakes per-cell fills / borders from `tcPr` and does NOT consult
 *    `ppt/tableStyles.xml`.
 */
export function parseTable(
  graphicFrame: Element,
  ctx: SlideParseContext,
): SlideElement[] {
  const xfrm = child(graphicFrame, 'xfrm');
  const xfrmFrame = parseXfrm(xfrm, ctx.scale);

  const tbl = descendant(graphicFrame, 'tbl');
  if (!tbl) return [];

  const tblPr = child(tbl, 'tblPr');
  const tableStyleId = tblPr
    ? child(tblPr, 'tableStyleId')?.textContent ?? undefined
    : undefined;

  const gridCols = children(child(tbl, 'tblGrid') ?? tbl, 'gridCol');
  const columnWidths = gridCols.map(
    (g) => (attrInt(g, 'w') ?? 0) * ctx.scale.sx,
  );

  const trs = children(tbl, 'tr');
  const rows: TableRow[] = trs.map((tr) => {
    const height = (attrInt(tr, 'h') ?? 0) * ctx.scale.sy;
    const tcs = children(tr, 'tc');
    const cells = tcs.map((tc) => parseCell(tc, ctx));
    return { height, cells };
  });

  // The renderer's frame-sync invariant requires
  // `frame.w == sum(columnWidths)` and `frame.h == sum(row.height)`,
  // so the grid is canonical even when xfrm.ext disagrees by a few EMU
  // (some authoring tools round). Position still comes from xfrm.off.
  const tableW = columnWidths.reduce((a, b) => a + b, 0);
  const tableH = rows.reduce((a, r) => a + r.height, 0);

  const table: TableElement = {
    id: generateId(),
    type: 'table',
    frame: {
      ...xfrmFrame,
      w: tableW,
      h: tableH,
    },
    data: {
      columnWidths,
      rows,
      ...(tableStyleId ? { tableStyleId } : {}),
    },
  };

  return [table];
}

function parseCell(tc: Element, ctx: SlideParseContext): TableCell {
  const tcPr = child(tc, 'tcPr');
  const txBody = child(tc, 'txBody');

  // OOXML covered-cell markers — see TableCell JSDoc for the contract.
  // `hMerge` / `vMerge` translate to `gridSpan: 0` / `rowSpan: 0` so
  // renderer / store ops can short-circuit via `isCovered`.
  const hMerge = attr(tc, 'hMerge') === '1';
  const vMerge = attr(tc, 'vMerge') === '1';
  const gridSpanAttr = attrInt(tc, 'gridSpan');
  const rowSpanAttr = attrInt(tc, 'rowSpan');

  let gridSpan: number | undefined;
  if (hMerge) gridSpan = 0;
  else if (gridSpanAttr !== undefined && gridSpanAttr !== 1) gridSpan = gridSpanAttr;

  let rowSpan: number | undefined;
  if (vMerge) rowSpan = 0;
  else if (rowSpanAttr !== undefined && rowSpanAttr !== 1) rowSpan = rowSpanAttr;

  const body = txBody
    ? {
        blocks: parseTextBody(txBody, {
          rels: ctx.rels,
          report: ctx.report,
          clrMap: ctx.clrMap,
        }),
      }
    : { blocks: [] };

  // Fold bodyPr's anchor into `style.verticalAlign` when tcPr's anchor
  // is absent. Two sources of vertical anchor on a single cell — body
  // and style — diverge when the toolbar writes only style: the
  // renderer reads `body.verticalAnchor ?? defaultVerticalAnchor`, so
  // a body-set anchor would silently override the toolbar's edit. PPTX
  // gives no semantic to having both, so picking one (style) keeps the
  // toolbar authoritative.
  const style = parseCellStyle(tcPr, ctx);
  if (style.verticalAlign === undefined && txBody) {
    const bodyAnchor = detectVerticalAnchor(txBody);
    if (bodyAnchor !== undefined) {
      style.verticalAlign = bodyAnchor as VerticalAnchorMode;
    }
  }

  return {
    body,
    style,
    ...(gridSpan !== undefined ? { gridSpan } : {}),
    ...(rowSpan !== undefined ? { rowSpan } : {}),
  };
}

function parseCellStyle(
  tcPr: Element | undefined,
  ctx: SlideParseContext,
): CellStyle {
  if (!tcPr) return {};
  const style: CellStyle = {};

  // Padding: tcPr marL/R/T/B (EMU → px). PowerPoint omits these when
  // the cell uses the ECMA-376 defaults (8 px LR, 4 px TB); the
  // renderer applies `DEFAULT_CELL_PADDING` for absent keys.
  const marL = attrInt(tcPr, 'marL');
  const marR = attrInt(tcPr, 'marR');
  const marT = attrInt(tcPr, 'marT');
  const marB = attrInt(tcPr, 'marB');
  if (
    marL !== undefined
    || marR !== undefined
    || marT !== undefined
    || marB !== undefined
  ) {
    style.padding = {};
    if (marL !== undefined) style.padding.left = marL * ctx.scale.sx;
    if (marR !== undefined) style.padding.right = marR * ctx.scale.sx;
    if (marT !== undefined) style.padding.top = marT * ctx.scale.sy;
    if (marB !== undefined) style.padding.bottom = marB * ctx.scale.sy;
  }

  // Fill: <a:solidFill> only in v1; gradient / pattern / blip fills
  // imported as a missing fill (clean fall-back rather than a wrong color).
  const solidFill = child(tcPr, 'solidFill');
  if (solidFill) {
    const color = parseColorFromContainer(solidFill, ctx.clrMap);
    if (color && !isInvisible(color)) {
      style.fill = color;
    }
  }

  // Vertical anchor: <a:tcPr anchor="t|ctr|b">.
  const anchorAttr = attr(tcPr, 'anchor');
  const vAlign = mapAnchor(anchorAttr);
  if (vAlign) style.verticalAlign = vAlign;

  // Per-side borders: lnL/lnR/lnT/lnB.
  const border: NonNullable<CellStyle['border']> = {};
  const left = parseCellBorder(child(tcPr, 'lnL'), ctx);
  if (left) border.left = left;
  const right = parseCellBorder(child(tcPr, 'lnR'), ctx);
  if (right) border.right = right;
  const top = parseCellBorder(child(tcPr, 'lnT'), ctx);
  if (top) border.top = top;
  const bottom = parseCellBorder(child(tcPr, 'lnB'), ctx);
  if (bottom) border.bottom = bottom;
  if (Object.keys(border).length > 0) style.border = border;

  return style;
}

function parseCellBorder(
  ln: Element | undefined,
  ctx: SlideParseContext,
): CellBorder | undefined {
  if (!ln) return undefined;
  const solid = child(ln, 'solidFill');
  if (!solid) return undefined;
  const color = parseColorFromContainer(solid, ctx.clrMap);
  if (!color) return undefined;
  // `<a:alpha val="0"/>` on a border color means the side is
  // intentionally invisible (PowerPoint writers use this to draw an
  // unstyled-looking table without dropping the four `<a:lnX>`
  // elements). Treat it as no border on that side.
  if (isInvisible(color)) return undefined;
  const wEmu = attrInt(ln, 'w');
  const width = wEmu != null ? emuToStrokePx(wEmu, ctx.scale) : 1;
  return { color, width };
}

function mapAnchor(a: string | undefined): VerticalAnchorMode | undefined {
  if (a === 't') return 'top';
  if (a === 'ctr') return 'middle';
  if (a === 'b') return 'bottom';
  return undefined;
}

function isInvisible(color: ThemeColor): boolean {
  return 'alpha' in color && color.alpha === 0;
}
