import { describe, it, expect, beforeEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { computeTableMergeContext } from '../../src/view/table-merge-context.js';
import type { BlockCellInfo, CellAddress, DocPosition } from '../../src/model/types.js';

function buildParentMap(doc: Doc, tableBlockId: string): Map<string, BlockCellInfo> {
  const map = new Map<string, BlockCellInfo>();
  const block = doc.getBlock(tableBlockId);
  if (!block.tableData) return map;
  for (let r = 0; r < block.tableData.rows.length; r++) {
    for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
      for (const b of block.tableData.rows[r].cells[c].blocks) {
        map.set(b.id, { tableBlockId, rowIndex: r, colIndex: c });
      }
    }
  }
  return map;
}

function cellBlockId(doc: Doc, tableId: string, cell: CellAddress): string {
  return doc.getBlock(tableId).tableData!.rows[cell.rowIndex].cells[cell.colIndex].blocks[0].id;
}

describe('computeTableMergeContext', () => {
  let doc: Doc;
  let tableId: string;
  let parentMap: Map<string, BlockCellInfo>;

  beforeEach(() => {
    doc = Doc.create();
    tableId = doc.insertTable(1, 3, 3);
    parentMap = buildParentMap(doc, tableId);
  });

  it('returns none when cursor is not in a table', () => {
    const pos: DocPosition = { blockId: doc.document.blocks[0].id, offset: 0 };
    expect(computeTableMergeContext(doc, parentMap, pos, null)).toEqual({ state: 'none' });
  });

  it('returns none for a single-cell cursor with no selection', () => {
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    expect(computeTableMergeContext(doc, parentMap, pos, null).state).toBe('none');
  });

  it('returns canMerge when a 2x2 cell range is active', () => {
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, {
      anchor: pos,
      focus: pos,
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 1, colIndex: 1 },
      },
    });
    expect(ctx.state).toBe('canMerge');
    if (ctx.state === 'canMerge') {
      expect(ctx.tableBlockId).toBe(tableId);
      expect(ctx.range.start).toEqual({ rowIndex: 0, colIndex: 0 });
      expect(ctx.range.end).toEqual({ rowIndex: 1, colIndex: 1 });
    }
  });

  it('returns none when the range covers exactly one cell (area 1)', () => {
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, {
      anchor: pos,
      focus: pos,
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 0 },
      },
    });
    expect(ctx.state).toBe('none');
  });

  it('returns canUnmerge when cursor is inside an existing merged cell', () => {
    doc.mergeCells(tableId, { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } });
    parentMap = buildParentMap(doc, tableId);
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, null);
    expect(ctx.state).toBe('canUnmerge');
    if (ctx.state === 'canUnmerge') {
      expect(ctx.cell).toEqual({ rowIndex: 0, colIndex: 0 });
      expect(ctx.tableBlockId).toBe(tableId);
    }
  });

  it('canMerge wins when cursor is in a merged cell and a range is also active', () => {
    doc.mergeCells(tableId, { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } });
    parentMap = buildParentMap(doc, tableId);
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, {
      anchor: pos,
      focus: pos,
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 2 },
      },
    });
    expect(ctx.state).toBe('canMerge');
  });
});
