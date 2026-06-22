/**
 * Serialize a `TableElement` to a PPTX `<p:graphicFrame>` containing a
 * DrawingML `<a:tbl>`.
 *
 * Inverse of `src/import/pptx/table.ts`.
 *
 * Covered-cell encoding contract (confirmed against importer):
 *   - `gridSpan === 0`  → `<a:tc hMerge="1">` (hMerge covered cell)
 *   - `rowSpan === 0`   → `<a:tc vMerge="1">` (vMerge covered cell)
 *   - `gridSpan > 1`    → `gridSpan="N"` on the anchor cell
 *   - `rowSpan > 1`     → `rowSpan="N"` on the anchor cell
 *   - `gridSpan === 1` or absent → omit the attribute
 *   - `rowSpan === 1` or absent → omit the attribute
 *
 * Border ordering in `<a:tcPr>`: lnL → lnR → lnT → lnB → solidFill.
 * This matches OOXML schema ordering (lnL, lnR, lnT, lnB precede fill
 * children in tcPr CT_TableCellProperties).
 */
import type { CellBorder, TableCell, TableElement } from '../../model/element.js';
import { attr, escapeXmlText } from './xml.js';
import { pxToEmuX, pxToEmuY, pxToEmu } from './units.js';
import { textBodyToXml } from './text.js';
import { solidFillXml, colorFromStringOrTheme } from './color.js';

export function tableToXml(el: TableElement): string {
  const { data, frame } = el;

  const grid = data.columnWidths
    .map((w) => `<a:gridCol w="${pxToEmuX(w)}"/>`)
    .join('');

  const rows = data.rows.map(rowToXml).join('');

  const tblPrContent = el.data.tableStyleId
    ? `<a:tableStyleId>${escapeXmlText(el.data.tableStyleId)}</a:tableStyleId>`
    : '';
  const tbl = `<a:tbl><a:tblPr>${tblPrContent}</a:tblPr><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl>`;

  const xfrm =
    `<p:xfrm>` +
    `<a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/>` +
    `<a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/>` +
    `</p:xfrm>`;

  // Use attr() helper so el.id and data.alt are XML-attribute-escaped.
  const cNvPr = `<p:cNvPr id="0"${attr('name', el.id)}${attr('descr', el.data.alt)}/>`;
  const nv = `<p:nvGraphicFramePr>${cNvPr}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`;

  const graphicData =
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `${tbl}` +
    `</a:graphicData>`;

  return (
    `<p:graphicFrame>` +
    `${nv}${xfrm}` +
    `<a:graphic>${graphicData}</a:graphic>` +
    `</p:graphicFrame>`
  );
}

function rowToXml(row: { height: number; cells: TableCell[] }): string {
  return `<a:tr h="${pxToEmuY(row.height)}">${row.cells.map(cellToXml).join('')}</a:tr>`;
}

function cellToXml(cell: TableCell): string {
  // Covered-cell fast paths — these cells carry no real content.
  if (cell.gridSpan === 0) {
    return `<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc>`;
  }
  if (cell.rowSpan === 0) {
    return `<a:tc vMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc>`;
  }

  // Anchor / unmerged cells.
  const spanAttr =
    cell.gridSpan !== undefined && cell.gridSpan > 1
      ? ` gridSpan="${cell.gridSpan}"`
      : '';
  const rspanAttr =
    cell.rowSpan !== undefined && cell.rowSpan > 1
      ? ` rowSpan="${cell.rowSpan}"`
      : '';

  // Table cells always use the default <a:txBody> tag (not <p:txBody>).
  const txBody = textBodyToXml(cell.body);

  return `<a:tc${spanAttr}${rspanAttr}>${txBody}${tcPrXml(cell)}</a:tc>`;
}

/**
 * Build `<a:tcPr>` with borders (lnL/R/T/B) followed by the cell fill.
 * OOXML CT_TableCellProperties schema order: lnL, lnR, lnT, lnB, then fill.
 */
function tcPrXml(cell: TableCell): string {
  const b = cell.style.border;

  const ln = (side: 'L' | 'R' | 'T' | 'B', border: CellBorder | undefined): string => {
    if (!border) return '';
    const color = colorFromStringOrTheme(border.color);
    const w = pxToEmu(border.width);
    return `<a:ln${side} w="${w}">${solidFillXml(color)}</a:ln${side}>`;
  };

  const borders = b
    ? ln('L', b.left) + ln('R', b.right) + ln('T', b.top) + ln('B', b.bottom)
    : '';

  const fill = cell.style.fill
    ? solidFillXml(colorFromStringOrTheme(cell.style.fill))
    : '';

  return `<a:tcPr>${borders}${fill}</a:tcPr>`;
}
