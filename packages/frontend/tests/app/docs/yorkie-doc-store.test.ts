import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import { generateBlockId, DEFAULT_BLOCK_STYLE, createTableBlock, createTableCell } from '@wafflebase/docs';
import type { Block, TableRow, TableCell as TCell } from '@wafflebase/docs';

function makeBlock(text: string, style?: Partial<Block['style']>): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE, ...style },
  };
}

function makeTableDoc(): { tableBlock: Block; doc: { blocks: Block[] } } {
  const tableBlock = createTableBlock(2, 2);
  return { tableBlock, doc: { blocks: [makeBlock('before'), tableBlock, makeBlock('after')] } };
}

describe('YorkieDocStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({
        type: 'doc',
        children: [],
      });
    });
    store = new YorkieDocStore(doc);
  });

  describe('setDocument and getDocument', () => {
    it('should set and retrieve a document', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      assert.equal(result.blocks.length, 1);
      assert.equal(result.blocks[0].inlines[0].text, 'Hello');
      assert.equal(result.blocks[0].id, block.id);
    });

    it('should handle empty document', () => {
      store.setDocument({ blocks: [] });
      assert.equal(store.getDocument().blocks.length, 0);
    });

    it('should handle multiple blocks', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      const result = store.getDocument();
      assert.equal(result.blocks.length, 2);
      assert.equal(result.blocks[0].inlines[0].text, 'First');
      assert.equal(result.blocks[1].inlines[0].text, 'Second');
    });

    it('should preserve block styles', () => {
      const block = makeBlock('Centered', { alignment: 'center', lineHeight: 2.0 });
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      assert.equal(result.blocks[0].style.alignment, 'center');
      assert.equal(result.blocks[0].style.lineHeight, 2.0);
    });

    it('should preserve inline styles', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'Bold', style: { bold: true, fontSize: 14 } },
          { text: ' Normal', style: {} },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      assert.equal(result.blocks[0].inlines.length, 2);
      assert.equal(result.blocks[0].inlines[0].style.bold, true);
      assert.equal(result.blocks[0].inlines[0].style.fontSize, 14);
    });
  });

  describe('getBlock', () => {
    it('should find block by ID', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      const found = store.getBlock(block.id);
      assert.ok(found);
      assert.equal(found.inlines[0].text, 'Hello');
    });

    it('should return undefined for missing block', () => {
      assert.equal(store.getBlock('nonexistent'), undefined);
    });
  });

  describe('updateBlock', () => {
    it('should update block content', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      const found = store.getBlock(block.id);
      assert.ok(found);
      assert.equal(found.inlines[0].text, 'World');
    });

    it('should throw for missing block', () => {
      assert.throws(() => store.updateBlock('missing', makeBlock('x')), /Block not found/);
    });
  });

  describe('insertBlock', () => {
    it('should insert at the given index', () => {
      const b1 = makeBlock('First');
      store.setDocument({ blocks: [b1] });
      const b2 = makeBlock('Second');
      store.insertBlock(0, b2);
      const result = store.getDocument();
      assert.equal(result.blocks.length, 2);
      assert.equal(result.blocks[0].inlines[0].text, 'Second');
      assert.equal(result.blocks[1].inlines[0].text, 'First');
    });
  });

  describe('deleteBlock', () => {
    it('should delete by ID', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      store.deleteBlock(b1.id);
      const result = store.getDocument();
      assert.equal(result.blocks.length, 1);
      assert.equal(result.blocks[0].id, b2.id);
    });

    it('should throw for missing block', () => {
      assert.throws(() => store.deleteBlock('missing'), /Block not found/);
    });
  });

  describe('deleteBlockByIndex', () => {
    it('should delete by index', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      store.deleteBlockByIndex(0);
      const result = store.getDocument();
      assert.equal(result.blocks.length, 1);
      assert.equal(result.blocks[0].id, b2.id);
    });
  });

  describe('pageSetup', () => {
    it('should return defaults when not set', () => {
      const setup = store.getPageSetup();
      assert.equal(setup.paperSize.name, 'Letter');
    });

    it('should set and get pageSetup', () => {
      store.setPageSetup({
        paperSize: { name: 'A4', width: 794, height: 1123 },
        orientation: 'portrait',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
      });
      const setup = store.getPageSetup();
      assert.equal(setup.paperSize.name, 'A4');
      assert.equal(setup.margins.top, 72);
    });
  });

  describe('undo/redo', () => {
    it('should undo after snapshot', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.snapshot();
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      assert.equal(store.getBlock(block.id)?.inlines[0].text, 'World');
      store.undo();
      assert.equal(store.getBlock(block.id)?.inlines[0].text, 'Hello');
    });

    it('should redo after undo', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.snapshot();
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      store.undo();
      store.redo();
      assert.equal(store.getBlock(block.id)?.inlines[0].text, 'World');
    });

    it('mutation without snapshot is not undoable', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      assert.equal(store.canUndo(), false);
    });

    it('should clear redo stack on new snapshot', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.snapshot();
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      store.undo();
      assert.equal(store.canRedo(), true);
      store.snapshot();
      assert.equal(store.canRedo(), false);
    });
  });

  describe('caching', () => {
    it('getDocument returns a deep clone (mutations do not affect store)', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      const doc = store.getDocument();
      doc.blocks[0].inlines[0].text = 'Mutated';
      assert.equal(store.getDocument().blocks[0].inlines[0].text, 'Hello');
    });
  });

  describe('insertTableRow', () => {
    it('should insert a row without affecting other rows', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
      cellBlock.inlines[0].text = 'keep me';
      store.updateBlock(tableBlock.id, tableBlock);

      const newRow: TableRow = { cells: [createTableCell(), createTableCell()] };
      store.insertTableRow(tableBlock.id, 1, newRow);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows.length, 3);
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'keep me');
      assert.equal(td.rows[1].cells.length, 2);
      assert.equal(td.rows[2].cells[0].blocks[0].inlines[0].text, '');
    });
  });

  describe('deleteTableRow', () => {
    it('should delete a row and preserve others', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cell10 = tableBlock.tableData!.rows[1].cells[0].blocks[0];
      cell10.inlines[0].text = 'row 1';
      store.updateBlock(tableBlock.id, tableBlock);

      store.deleteTableRow(tableBlock.id, 0);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows.length, 1);
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'row 1');
    });
  });

  describe('insertTableColumn', () => {
    it('should insert a column in every row', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const newCells: TCell[] = [createTableCell(), createTableCell()];
      store.insertTableColumn(tableBlock.id, 1, newCells);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows[0].cells.length, 3);
      assert.equal(td.rows[1].cells.length, 3);
    });
  });

  describe('deleteTableColumn', () => {
    it('should delete a column from every row', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      store.deleteTableColumn(tableBlock.id, 0);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows[0].cells.length, 1);
      assert.equal(td.rows[1].cells.length, 1);
    });
  });

  describe('updateTableCell', () => {
    it('should update one cell without affecting others', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cell00 = tableBlock.tableData!.rows[0].cells[0];
      cell00.blocks[0].inlines[0].text = 'original 00';
      const cell11 = tableBlock.tableData!.rows[1].cells[1];
      cell11.blocks[0].inlines[0].text = 'original 11';
      store.updateBlock(tableBlock.id, tableBlock);

      const updatedCell = createTableCell();
      updatedCell.blocks[0].inlines[0].text = 'updated 00';
      store.updateTableCell(tableBlock.id, 0, 0, updatedCell);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'updated 00');
      assert.equal(td.rows[1].cells[1].blocks[0].inlines[0].text, 'original 11');
    });
  });

  describe('updateTableAttrs', () => {
    it('should update column widths without affecting cell content', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cell00 = tableBlock.tableData!.rows[0].cells[0];
      cell00.blocks[0].inlines[0].text = 'keep me';
      store.updateBlock(tableBlock.id, tableBlock);

      store.updateTableAttrs(tableBlock.id, { cols: [0.7, 0.3] });

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.deepEqual(td.columnWidths, [0.7, 0.3]);
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'keep me');
    });
  });

  describe('granular table ops preserve surrounding blocks', () => {
    it('should not affect blocks before and after the table', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      store.insertTableRow(tableBlock.id, 1, { cells: [createTableCell(), createTableCell()] });

      const result = store.getDocument();
      assert.equal(result.blocks[0].inlines[0].text, 'before');
      assert.equal(result.blocks[2].inlines[0].text, 'after');
    });
  });

  describe('splitBlock', () => {
    it('should split a block at offset into two blocks', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-block-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks.length, 2);
      assert.equal(result.blocks[0].inlines[0].text, 'Hello');
      assert.equal(result.blocks[1].inlines[0].text, 'World');
      assert.equal(result.blocks[1].id, 'new-block-id');
      assert.equal(result.blocks[1].type, 'paragraph');
    });

    it('should split at start — first block gets empty inline', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 0, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks.length, 2);
      assert.equal(result.blocks[0].inlines[0].text, '');
      assert.equal(result.blocks[1].inlines[0].text, 'Hello');
    });

    it('should split at end — second block gets empty inline', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks.length, 2);
      assert.equal(result.blocks[0].inlines[0].text, 'Hello');
      assert.equal(result.blocks[1].inlines[0].text, '');
    });

    it('should preserve surrounding blocks', () => {
      const b1 = makeBlock('Before');
      const b2 = makeBlock('SplitMe');
      const b3 = makeBlock('After');
      store.setDocument({ blocks: [b1, b2, b3] });
      store.splitBlock(b2.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks.length, 4);
      assert.equal(result.blocks[0].inlines[0].text, 'Before');
      assert.equal(result.blocks[1].inlines[0].text, 'Split');
      assert.equal(result.blocks[2].inlines[0].text, 'Me');
      assert.equal(result.blocks[3].inlines[0].text, 'After');
    });
  });

  describe('mergeBlock', () => {
    it('should merge two adjacent blocks into one', () => {
      const b1 = makeBlock('Hello');
      const b2 = makeBlock(' World');
      store.setDocument({ blocks: [b1, b2] });
      store.mergeBlock(b1.id, b2.id);
      const result = store.getDocument();
      assert.equal(result.blocks.length, 1);
      assert.equal(result.blocks[0].inlines[0].text, 'Hello World');
      assert.equal(result.blocks[0].id, b1.id);
    });

    it('should preserve surrounding blocks', () => {
      const b1 = makeBlock('Before');
      const b2 = makeBlock('Hello');
      const b3 = makeBlock(' World');
      const b4 = makeBlock('After');
      store.setDocument({ blocks: [b1, b2, b3, b4] });
      store.mergeBlock(b2.id, b3.id);
      const result = store.getDocument();
      assert.equal(result.blocks.length, 3);
      assert.equal(result.blocks[0].inlines[0].text, 'Before');
      assert.equal(result.blocks[1].inlines[0].text, 'Hello World');
      assert.equal(result.blocks[2].inlines[0].text, 'After');
    });

    it('should throw when merging a block with itself', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      assert.throws(() => store.mergeBlock(block.id, block.id), /Cannot merge/);
    });
  });
});
