import { describe, test, expect } from 'vitest';
import { treeNodeToBlock, type DocsTreeNode } from '../../src/model/crdt-tree.js';
import { MAX_TABLE_NESTING_DEPTH } from '../../src/model/table-nesting.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { stubMeasurer } from '../view/_stub-measurer.js';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block, BlockCellInfo, TableData } from '../../src/model/types.js';
import { Doc } from '../../src/model/document.js';
import { MemDocStore } from '../../src/store/memory.js';
import { capTableNesting, capTableCellsNesting } from '../../src/view/clipboard.js';

/**
 * Nesting is the one shape in this model a peer can make arbitrarily deep with
 * ordinary Tree writes — no attribute is out of band, so none of the numeric
 * bands reach it — and both the reader and the layout walk it by recursion.
 * Unbounded, a few tens of thousands of levels overflow the stack of every
 * reader on first read or first paint, for a document nobody can then open to
 * repair it.
 */

/** A `block` tree node holding a table nested `depth` levels deep. */
function nestedTableTree(depth: number): DocsTreeNode {
  let node: DocsTreeNode = {
    type: 'block',
    attributes: { type: 'paragraph', id: 'leaf' },
    children: [{ type: 'inline', attributes: {}, children: [{ type: 'text', value: 'hi' }] }],
  };
  for (let d = depth; d > 0; d--) {
    node = {
      type: 'block',
      attributes: { type: 'table', id: `t${d}`, cols: '1' },
      children: [
        { type: 'row', attributes: {}, children: [{ type: 'cell', attributes: {}, children: [node] }] },
      ],
    };
  }
  return node;
}

/** How many tables deep the read block actually goes. */
function readDepth(block: Block | undefined): number {
  let depth = 0;
  let current = block;
  while (current?.type === 'table' && (current.tableData?.rows.length ?? 0) > 0) {
    depth++;
    current = current.tableData!.rows[0].cells[0].blocks[0];
  }
  return depth;
}

describe('the CRDT read path caps table nesting', () => {
  test('an ordinary nesting depth is read whole', () => {
    expect(readDepth(treeNodeToBlock(nestedTableTree(3)))).toBe(3);
  });

  test('a chain deeper than the cap is truncated, not read to the bottom', () => {
    const block = treeNodeToBlock(nestedTableTree(MAX_TABLE_NESTING_DEPTH + 50));

    expect(readDepth(block)).toBe(MAX_TABLE_NESTING_DEPTH);
  });

  test('a chain deep enough to overflow the stack still reads', () => {
    // 50,000 levels is well past any engine's call-stack limit: before the cap
    // this threw `RangeError: Maximum call stack size exceeded` and the
    // document could not be opened at all.
    const block = treeNodeToBlock(nestedTableTree(50_000));

    expect(readDepth(block)).toBe(MAX_TABLE_NESTING_DEPTH);
  });

  test('the table at the cap is a table with no rows, not a dropped block', () => {
    let current: Block | undefined = treeNodeToBlock(nestedTableTree(MAX_TABLE_NESTING_DEPTH + 1));
    for (let d = 0; d < MAX_TABLE_NESTING_DEPTH; d++) {
      current = current!.tableData!.rows[0].cells[0].blocks[0];
    }

    expect(current!.type).toBe('table');
    expect(current!.tableData!.rows).toEqual([]);
  });
});

describe('the layout caps table nesting on its own', () => {
  /**
   * The reader truncates what arrives over the CRDT, but the layout also takes
   * documents from producers that never pass through it (DOCX import, paste),
   * so `computeTableLayout` ⇄ `layoutCellBlocks` bounds its own recursion.
   */
  function nestedTableData(depth: number): TableData {
    const style = { ...DEFAULT_BLOCK_STYLE };
    let blocks: Block[] = [
      { id: 'leaf', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style },
    ];
    let data: TableData = { rows: [{ cells: [{ blocks, style: {} }] }], columnWidths: [1] };
    for (let d = 1; d < depth; d++) {
      blocks = [{ id: `t${d}`, type: 'table', inlines: [], style, tableData: data }];
      data = { rows: [{ cells: [{ blocks, style: {} }] }], columnWidths: [1] };
    }
    return data;
  }

  test('lays out a chain deep enough to overflow the stack', () => {
    expect(() =>
      computeTableLayout(nestedTableData(20_000), 'top', stubMeasurer(), 600),
    ).not.toThrow();
  });
});

/**
 * The editor's own producers. The importer caps what a `.docx` may contain and
 * the CRDT writers cap what reaches the tree, but the two gestures that create
 * nesting interactively — "insert table" with the caret already in a cell, and
 * a paste carrying tables — build the model *before* either of those sees it,
 * so each has to know the ceiling too.
 */
describe('the interactive producers cap nesting', () => {
  /** A parent map putting `leaf` inside `depth` nested tables. */
  function chainParentMap(depth: number): Map<string, BlockCellInfo> {
    const map = new Map<string, BlockCellInfo>();
    let child = 'leaf';
    for (let d = depth; d > 0; d--) {
      map.set(child, { tableBlockId: `t${d}`, rowIndex: 0, colIndex: 0 });
      child = `t${d}`;
    }
    return map;
  }

  function docWithChain(depth: number): Doc {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    const doc = new Doc(store);
    doc.setBlockParentMap(chainParentMap(depth));
    return doc;
  }

  test('tableNestingDepth counts the tables around a block', () => {
    expect(docWithChain(0).tableNestingDepth('leaf')).toBe(0);
    expect(docWithChain(3).tableNestingDepth('leaf')).toBe(3);
    expect(docWithChain(MAX_TABLE_NESTING_DEPTH + 5).tableNestingDepth('leaf'))
      .toBe(MAX_TABLE_NESTING_DEPTH);
  });

  test('tableNestingDepth stops on a cyclic parent map', () => {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    const doc = new Doc(store);
    doc.setBlockParentMap(new Map<string, BlockCellInfo>([
      ['leaf', { tableBlockId: 'a', rowIndex: 0, colIndex: 0 }],
      ['a', { tableBlockId: 'b', rowIndex: 0, colIndex: 0 }],
      ['b', { tableBlockId: 'a', rowIndex: 0, colIndex: 0 }],
    ]));

    expect(doc.tableNestingDepth('leaf')).toBe(2);
  });

  test('insertTableInCell refuses to nest past the cap', () => {
    const doc = docWithChain(MAX_TABLE_NESTING_DEPTH);

    expect(() => doc.insertTableInCell('leaf', 2, 2)).toThrow(/nesting cap/);
  });

  test('a pasted fragment loses only the tables past the ceiling', () => {
    const style = { ...DEFAULT_BLOCK_STYLE };
    const inner: Block = {
      id: 'inner', type: 'table', inlines: [], style,
      tableData: { rows: [{ cells: [{ blocks: [
        { id: 'deep', type: 'paragraph', inlines: [{ text: 'deep', style: {} }], style },
      ], style: {} }] }], columnWidths: [1] },
    };
    const outer: Block = {
      id: 'outer', type: 'table', inlines: [], style,
      tableData: { rows: [{ cells: [{ blocks: [inner], style: {} }] }], columnWidths: [1] },
    };
    const text: Block = {
      id: 'p', type: 'paragraph', inlines: [{ text: 'kept', style: {} }], style,
    };

    // Dropped two levels from the ceiling: `outer` fits, `inner` does not.
    const capped = capTableNesting(
      [text, outer],
      MAX_TABLE_NESTING_DEPTH - 1,
    );

    expect(capped.map((b) => b.id)).toEqual(['p', 'outer']);
    // The cell that held the over-deep table keeps a block, so the table it
    // sits in still has a caret position.
    const cell = capped[1].tableData!.rows[0].cells[0];
    expect(cell.blocks).toHaveLength(1);
    expect(cell.blocks[0].type).toBe('paragraph');
  });

  test('a pasted cell rectangle loses only the tables past the ceiling', () => {
    // The other paste writer: `pasteTableCells` clones whole clipboard cells
    // into a target cell, and a clipboard cell can carry a nested table of its
    // own. Before the cap reached it, that table was written at whatever depth
    // the target sat at — past the ceiling every reader stops at.
    const style = { ...DEFAULT_BLOCK_STYLE };
    const nested: Block = {
      id: 'nested', type: 'table', inlines: [], style,
      tableData: { rows: [{ cells: [{ blocks: [
        { id: 'deep', type: 'paragraph', inlines: [{ text: 'deep', style: {} }], style },
      ], style: {} }] }], columnWidths: [1] },
    };
    const text: Block = {
      id: 'kept', type: 'paragraph', inlines: [{ text: 'kept', style: {} }], style,
    };

    const capped = capTableCellsNesting(
      [[{ blocks: [text, nested], style: {} }]],
      MAX_TABLE_NESTING_DEPTH,
    );

    // The cell keeps its text; only the table that would land at the ceiling
    // goes, the same "degrade, do not vanish" answer the block paste gives.
    expect(capped[0][0].blocks.map((b) => b.id)).toEqual(['kept']);
  });

  test('a pasted cell rectangle one level short of the cap keeps its table', () => {
    const style = { ...DEFAULT_BLOCK_STYLE };
    const nested: Block = {
      id: 'nested', type: 'table', inlines: [], style,
      tableData: { rows: [{ cells: [{ blocks: [
        { id: 'deep', type: 'paragraph', inlines: [{ text: 'deep', style: {} }], style },
      ], style: {} }] }], columnWidths: [1] },
    };

    const capped = capTableCellsNesting(
      [[{ blocks: [nested], style: {} }]],
      MAX_TABLE_NESTING_DEPTH - 1,
    );

    expect(capped[0][0].blocks.map((b) => b.id)).toEqual(['nested']);
  });

  test('a cell emptied by the cap still holds a block', () => {
    const style = { ...DEFAULT_BLOCK_STYLE };
    const nested: Block = {
      id: 'nested', type: 'table', inlines: [], style,
      tableData: { rows: [{ cells: [{ blocks: [createEmptyBlock()], style: {} }] }], columnWidths: [1] },
    };

    const capped = capTableCellsNesting(
      [[{ blocks: [nested], style: {} }]],
      MAX_TABLE_NESTING_DEPTH,
    );

    // A cell with no blocks has no caret position at all, so the cap leaves
    // an empty paragraph behind rather than an empty cell.
    expect(capped[0][0].blocks).toHaveLength(1);
    expect(capped[0][0].blocks[0].type).toBe('paragraph');
  });

  test('a fragment pasted at the top level is untouched', () => {
    const style = { ...DEFAULT_BLOCK_STYLE };
    const table: Block = {
      id: 'outer', type: 'table', inlines: [], style,
      tableData: { rows: [{ cells: [{ blocks: [
        { id: 'x', type: 'paragraph', inlines: [{ text: 'x', style: {} }], style },
      ], style: {} }] }], columnWidths: [1] },
    };

    expect(capTableNesting([table], 0)).toEqual([table]);
  });
});
