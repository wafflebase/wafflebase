import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { normalizeTableMerges, DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';
import { cloneTableCells } from '../../src/view/clipboard.js';
import type { TableCell, TableData } from '../../src/model/types.js';

/**
 * Regression coverage for "pasting a copied cell range that touches a merged
 * region breaks the table".
 *
 * Table cell paste copies merge metadata (`colSpan` / `rowSpan`, including the
 * `colSpan: 0` covered markers) verbatim, so the pasted block can violate the
 * grid invariant the layout trusts. `normalizeTableMerges` repairs that
 * invariant; `pasteTableCells` runs it after writing the pasted cells.
 *
 * These tests reproduce the exact cell shapes the copy/paste data flow
 * produces, then assert the helper restores a consistent grid.
 */

// Mirror of TextEditor.getSelectedTableCells: slice the selected rectangle
// verbatim (spans included), then clone like the clipboard does.
function copyRange(
  td: TableData,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
): TableCell[][] {
  const rows: TableCell[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: TableCell[] = [];
    for (let c = c0; c <= c1; c++) {
      const cell = td.rows[r]?.cells[c];
      if (cell) row.push(cell);
    }
    rows.push(row);
  }
  return cloneTableCells(rows);
}

// Mirror of TextEditor.pasteTableCells (in-table branch) write loop.
function pasteRange(
  td: TableData,
  cells: TableCell[][],
  startRow: number,
  startCol: number,
): void {
  for (let r = 0; r < cells.length; r++) {
    const targetRow = startRow + r;
    if (targetRow >= td.rows.length) break;
    for (let c = 0; c < cells[r].length; c++) {
      const targetCol = startCol + c;
      if (targetCol >= td.rows[targetRow].cells.length) continue;
      td.rows[targetRow].cells[targetCol] = cloneTableCells([[cells[r][c]]])[0][0];
    }
  }
}

/**
 * The grid invariant the layout (table-layout.ts) relies on. Returns a list
 * of violations; an empty list means the grid is consistent.
 */
function gridViolations(td: TableData): string[] {
  const numRows = td.rows.length;
  const numCols = td.rows[0]?.cells.length ?? 0;
  const coveredBy: (string | null)[][] = Array.from({ length: numRows }, () =>
    new Array<string | null>(numCols).fill(null),
  );
  const violations: string[] = [];

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = td.rows[r].cells[c];
      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      if (cs > 1 || rs > 1) {
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= numRows || cc >= numCols) {
              violations.push(`anchor (${r},${c}) span ${cs}x${rs} overruns grid`);
              continue;
            }
            if (coveredBy[rr][cc] !== null) {
              violations.push(`cell (${rr},${cc}) covered by both ${coveredBy[rr][cc]} and ${r},${c}`);
            }
            coveredBy[rr][cc] = `${r},${c}`;
          }
        }
      }
    }
  }

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (td.rows[r].cells[c].colSpan === 0 && coveredBy[r][c] === null) {
        violations.push(`orphaned covered cell (${r},${c}) with no anchor`);
      }
    }
  }
  return violations;
}

function mergedTable(): TableData {
  const doc = Doc.create();
  const id = doc.insertTable(1, 3, 3);
  // Top-left 2x2 merge: anchor (0,0) colSpan2/rowSpan2; covered (0,1),(1,0),(1,1).
  doc.mergeCells(id, {
    start: { rowIndex: 0, colIndex: 0 },
    end: { rowIndex: 1, colIndex: 1 },
  });
  return doc.getBlock(id).tableData!;
}

describe('normalizeTableMerges', () => {
  it('leaves a healthy merged grid untouched', () => {
    const td = mergedTable();
    expect(gridViolations(td)).toEqual([]);
    normalizeTableMerges(td);
    expect(gridViolations(td)).toEqual([]);
    expect(td.rows[0].cells[0].colSpan).toBe(2);
    expect(td.rows[0].cells[0].rowSpan).toBe(2);
    expect(td.rows[0].cells[1].colSpan).toBe(0);
  });

  it('restores an orphaned covered cell (copy starts inside a merge)', () => {
    const src = mergedTable();
    // Select bottom-right 2x2 (1,1)-(2,2): top-left (1,1) is a covered cell
    // whose anchor (0,0) is NOT in the selection.
    const copied = copyRange(src, 1, 1, 2, 2);
    expect(copied[0][0].colSpan).toBe(0);

    const dst = mergedTable();
    // Split dst's merge first so we paste into a plain region.
    pasteRange(dst, copied, 0, 0);
    expect(gridViolations(dst).length).toBeGreaterThan(0); // broken pre-normalize

    normalizeTableMerges(dst);
    expect(gridViolations(dst)).toEqual([]);
    // The pasted covered marker at (0,0) is restored to a normal cell.
    expect(dst.rows[0].cells[0].colSpan ?? 1).not.toBe(0);
  });

  it('clamps a merged anchor pasted near the grid edge', () => {
    const src = mergedTable();
    const copied = copyRange(src, 0, 0, 1, 1); // the merged 2x2

    const dst = mergedTable();
    pasteRange(dst, copied, 2, 2); // anchor lands in the last cell
    expect(gridViolations(dst).length).toBeGreaterThan(0); // overrun pre-normalize

    normalizeTableMerges(dst);
    expect(gridViolations(dst)).toEqual([]);
  });

  it('resolves overlapping anchors with first-anchor-wins', () => {
    const td: TableData = {
      columnWidths: [1 / 3, 1 / 3, 1 / 3],
      rows: [
        { cells: [cell({ colSpan: 2, rowSpan: 2 }), cell({ colSpan: 2 }), cell()] },
        { cells: [cell(), cell(), cell()] },
        { cells: [cell(), cell(), cell()] },
      ],
    };
    normalizeTableMerges(td);
    expect(gridViolations(td)).toEqual([]);
  });
});

function cell(spans?: { colSpan?: number; rowSpan?: number }): TableCell {
  return {
    blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
    style: {},
    ...(spans?.colSpan != null ? { colSpan: spans.colSpan } : {}),
    ...(spans?.rowSpan != null ? { rowSpan: spans.rowSpan } : {}),
  };
}
