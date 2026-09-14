import { describe, test, expect } from 'vitest';
import { treeNodeToBlock, type DocsTreeNode } from '../../src/model/crdt-tree.js';
import { MAX_TABLE_NESTING_DEPTH } from '../../src/model/table-nesting.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { stubMeasurer } from '../view/_stub-measurer.js';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';
import type { Block, TableData } from '../../src/model/types.js';

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
