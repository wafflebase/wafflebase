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

    it('should allow insertText into the empty block created by split-at-end', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const after = store.getDocument();
      const emptyBlockId = after.blocks[1].id;
      // This must not throw "unacceptable path"
      store.insertText(emptyBlockId, 0, 'World');
      const result = store.getDocument();
      assert.equal(result.blocks[1].inlines[0].text, 'World');
    });

    it('should allow insertText after splitting an empty block (double Enter)', () => {
      // Simulates: type "Hello" → Enter → Enter → type "World" in middle empty block
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });

      // First Enter: split at end of "Hello"
      store.splitBlock(block.id, 5, 'empty-block-1', 'paragraph');
      const step1 = store.getDocument();
      assert.equal(step1.blocks.length, 2);

      // Second Enter: split the empty block at offset 0
      store.splitBlock('empty-block-1', 0, 'empty-block-2', 'paragraph');
      const step2 = store.getDocument();
      assert.equal(step2.blocks.length, 3);

      // Now try to insert text into the first empty block (block index 1)
      // This must not throw "YorkieError: unacceptable path"
      store.insertText('empty-block-1', 0, 'World');
      const result = store.getDocument();
      assert.equal(result.blocks[1].inlines[0].text, 'World');
    });

    it('should splitBlock on a block with no inline children in Yorkie tree', () => {
      // A block with no inline children should be splittable (Enter key).
      const blockId = 'orphan-block';
      store.setDocument({
        blocks: [
          {
            id: blockId,
            type: 'paragraph',
            inlines: [{ text: '', style: {} }],
            style: { ...DEFAULT_BLOCK_STYLE },
          },
        ],
      });

      // Remove the inline child from the Yorkie tree
      doc.update((root) => {
        root.content.editByPath([0, 0], [0, 1]);
      });

      // This must not throw "YorkieError: unacceptable path"
      store.splitBlock(blockId, 0, 'new-block', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks.length, 2);
    });

    it('should insertText into a block with no inline children in Yorkie tree', () => {
      // Reproduce the production bug: a block exists in the Yorkie tree
      // with no inline children (e.g. due to prior edits or GC).
      const blockId = 'orphan-block';
      // Set up a normal document first
      store.setDocument({
        blocks: [
          {
            id: blockId,
            type: 'paragraph',
            inlines: [{ text: '', style: {} }],
            style: { ...DEFAULT_BLOCK_STYLE },
          },
        ],
      });

      // Now manually remove the inline child from the Yorkie tree
      // to simulate the production state where a block has no inlines.
      doc.update((root) => {
        const tree = root.content;
        // Remove the inline child at path [0, 0] to [0, 1]
        tree.editByPath([0, 0], [0, 1]);
      });

      // Verify the Yorkie tree block has no inline children
      const tree = doc.getRoot().content;
      const treeRoot = tree.getRootTreeNode();
      const blockNode = treeRoot.children[0];
      const inlines = (blockNode.children || []).filter((c) => c.type === 'inline');
      assert.equal(inlines.length, 0, 'block should have no inline children');

      // This must not throw "YorkieError: unacceptable path"
      store.insertText(blockId, 0, 'Hello');
      const result = store.getDocument();
      assert.equal(result.blocks[0].inlines[0].text, 'Hello');
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

  describe('applyStyle', () => {
    it('should apply bold to a middle range', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 3, 8, { bold: true });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 3);
      assert.equal(result.inlines[0].text, 'Hel');
      assert.equal(result.inlines[0].style.bold, undefined);
      assert.equal(result.inlines[1].text, 'loWor');
      assert.equal(result.inlines[1].style.bold, true);
      assert.equal(result.inlines[2].text, 'ld');
      assert.equal(result.inlines[2].style.bold, undefined);
    });

    it('should apply bold to block start', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 3, { bold: true });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 2);
      assert.equal(result.inlines[0].text, 'Hel');
      assert.equal(result.inlines[0].style.bold, true);
      assert.equal(result.inlines[1].text, 'lo');
      assert.equal(result.inlines[1].style.bold, undefined);
    });

    it('should apply bold to block end', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 3, 5, { bold: true });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 2);
      assert.equal(result.inlines[0].text, 'Hel');
      assert.equal(result.inlines[0].style.bold, undefined);
      assert.equal(result.inlines[1].text, 'lo');
      assert.equal(result.inlines[1].style.bold, true);
    });

    it('should apply bold to entire block', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 1);
      assert.equal(result.inlines[0].text, 'Hello');
      assert.equal(result.inlines[0].style.bold, true);
    });

    it('should apply style across existing multi-inline block', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'Hello', style: { bold: true } },
          { text: 'World', style: {} },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 3, 8, { italic: true });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 4);
      assert.equal(result.inlines[0].text, 'Hel');
      assert.equal(result.inlines[0].style.bold, true);
      assert.equal(result.inlines[0].style.italic, undefined);
      assert.equal(result.inlines[1].text, 'lo');
      assert.equal(result.inlines[1].style.bold, true);
      assert.equal(result.inlines[1].style.italic, true);
      assert.equal(result.inlines[2].text, 'Wor');
      assert.equal(result.inlines[2].style.italic, true);
      assert.equal(result.inlines[3].text, 'ld');
      assert.equal(result.inlines[3].style.italic, undefined);
    });

    it('should work correctly after text insert', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertText(block.id, 5, ' World');
      store.applyStyle(block.id, 6, 11, { bold: true });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 2);
      assert.equal(result.inlines[0].text, 'Hello ');
      assert.equal(result.inlines[0].style.bold, undefined);
      assert.equal(result.inlines[1].text, 'World');
      assert.equal(result.inlines[1].style.bold, true);
    });

    it('should toggle bold off when re-applied to same range', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 3, { bold: true });
      // Now un-bold "Hel"
      store.applyStyle(block.id, 0, 3, { bold: false });
      const result = store.getBlock(block.id)!;
      // Text is preserved across inlines
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'Hello');
      // The first inline covering "Hel" should have bold:false (not true)
      assert.equal(result.inlines[0].style.bold, false);
    });

    it('should preserve bold for text inserted inside bold region', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true });
      store.insertText(block.id, 3, 'XX');
      const result = store.getBlock(block.id)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'HelXXlo');
      // All text should be bold since insertion inherits the inline style
      for (const inline of result.inlines) {
        assert.equal(inline.style.bold, true, `"${inline.text}" should be bold`);
      }
    });
  });

  describe('split then merge round-trip', () => {
    it('should produce the original text after split then merge', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const afterSplit = store.getDocument();
      assert.equal(afterSplit.blocks.length, 2);

      store.mergeBlock(afterSplit.blocks[0].id, afterSplit.blocks[1].id);
      const afterMerge = store.getDocument();
      assert.equal(afterMerge.blocks.length, 1);
      assert.equal(afterMerge.blocks[0].inlines[0].text, 'HelloWorld');
    });
  });

  describe('splitBlock with styled inlines', () => {
    it('should preserve inline styles across split at inline boundary', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'Bold', style: { bold: true } },
          { text: 'Normal', style: {} },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      // Split at offset 4 (end of "Bold")
      store.splitBlock(block.id, 4, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks[0].inlines[0].text, 'Bold');
      assert.equal(result.blocks[0].inlines[0].style.bold, true);
      assert.equal(result.blocks[1].inlines[0].text, 'Normal');
    });

    it('should preserve bold style when splitting inside a bold inline', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'HelloWorld', style: { bold: true } }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks[0].inlines[0].text, 'Hello');
      assert.equal(result.blocks[0].inlines[0].style.bold, true);
      assert.equal(result.blocks[1].inlines[0].text, 'World');
      assert.equal(result.blocks[1].inlines[0].style.bold, true,
        'bold style should be preserved on the right half after split');
    });

    it('should preserve bold attr in Yorkie Tree after split (not just cache)', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'HelloWorld', style: { bold: true } }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');

      // Read directly from Yorkie Tree, bypassing the cache
      const root = doc.getRoot();
      const tree = root.content;
      const treeRoot = tree.getRootTreeNode();
      const afterBlock = treeRoot.children[1];
      const afterInline = afterBlock.children[0];
      assert.equal(afterInline.attributes?.bold, 'true',
        'Yorkie Tree node should have bold attribute after split');
    });

    it('should preserve bold style when peer reads from Tree after remote split', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'HelloWorld', style: { bold: true } }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');

      // Simulate remote-change: invalidate cache so getDocument() re-parses from Tree
      // @ts-expect-error accessing private field for test
      store.dirty = true;
      // @ts-expect-error accessing private field for test
      store.cachedDoc = null;

      const result = store.getDocument();
      assert.equal(result.blocks[1].inlines[0].text, 'World');
      assert.equal(result.blocks[1].inlines[0].style.bold, true,
        'peer should see bold style after remote split');
    });

    it('should preserve multiple inline styles when splitting mid-inline', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'HelloWorld', style: { bold: true, italic: true, fontSize: 18 } }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks[1].inlines[0].text, 'World');
      assert.equal(result.blocks[1].inlines[0].style.bold, true);
      assert.equal(result.blocks[1].inlines[0].style.italic, true);
      assert.equal(result.blocks[1].inlines[0].style.fontSize, 18);
    });
  });

  describe('splitBlock with block-level attributes', () => {
    it('should split heading into paragraph — heading attrs stay on first block', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'heading',
        headingLevel: 2,
        inlines: [{ text: 'HelloWorld', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      assert.equal(result.blocks[0].type, 'heading');
      assert.equal(result.blocks[0].headingLevel, 2);
      assert.equal(result.blocks[1].type, 'paragraph');
      assert.equal(result.blocks[1].headingLevel, undefined);
    });

    it('should split list-item into list-item — list attrs preserved on both', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'list-item',
        listKind: 'ordered',
        listLevel: 1,
        inlines: [{ text: 'HelloWorld', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'list-item');
      const result = store.getDocument();
      assert.equal(result.blocks[0].type, 'list-item');
      assert.equal(result.blocks[0].listKind, 'ordered');
      assert.equal(result.blocks[0].listLevel, 1);
      assert.equal(result.blocks[1].type, 'list-item');
      assert.equal(result.blocks[1].listKind, 'ordered');
      assert.equal(result.blocks[1].listLevel, 1);
    });
  });

  function makeTableWithText(): { tableBlock: Block; cellBlockId: string } {
    const tableBlock = createTableBlock(2, 2);
    // Put text in cell [0][0]
    const cellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
    cellBlock.inlines = [{ text: 'Hello', style: {} }];
    return { tableBlock, cellBlockId: cellBlock.id };
  }

  describe('table cell internal edits', () => {

    it('should insertText into a table cell block', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.insertText(cellBlockId, 5, ' World');
      const result = store.getBlock(cellBlockId)!;
      assert.equal(result.inlines[0].text, 'Hello World');
    });

    it('should deleteText from a table cell block', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.deleteText(cellBlockId, 0, 3);
      const result = store.getBlock(cellBlockId)!;
      assert.equal(result.inlines[0].text, 'lo');
    });

    it('should insertText at middle of cell text', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.insertText(cellBlockId, 2, 'XX');
      const result = store.getBlock(cellBlockId)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'HeXXllo');
    });

    it('should work with table preceded by other blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      const before = makeBlock('Before');
      store.setDocument({ blocks: [before, tableBlock] });
      store.insertText(cellBlockId, 5, '!');
      const result = store.getBlock(cellBlockId)!;
      assert.equal(result.inlines[0].text, 'Hello!');
    });

    it('should applyStyle to a table cell block', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.applyStyle(cellBlockId, 0, 3, { bold: true });
      const result = store.getBlock(cellBlockId)!;
      assert.equal(result.inlines[0].text, 'Hel');
      assert.equal(result.inlines[0].style.bold, true);
      assert.equal(result.inlines[1].text, 'lo');
      assert.equal(result.inlines[1].style.bold, undefined);
    });

    it('should applyStyle after insertText in cell', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.insertText(cellBlockId, 5, ' World');
      store.applyStyle(cellBlockId, 6, 11, { italic: true });
      const result = store.getBlock(cellBlockId)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'Hello World');
      assert.equal(result.inlines[1].text, 'World');
      assert.equal(result.inlines[1].style.italic, true);
    });

    it('should edit different cells independently', () => {
      const tableBlock = createTableBlock(2, 2);
      const cell00 = tableBlock.tableData!.rows[0].cells[0].blocks[0];
      const cell11 = tableBlock.tableData!.rows[1].cells[1].blocks[0];
      cell00.inlines = [{ text: 'A', style: {} }];
      cell11.inlines = [{ text: 'B', style: {} }];
      store.setDocument({ blocks: [tableBlock] });

      store.insertText(cell00.id, 1, '1');
      store.insertText(cell11.id, 1, '2');

      assert.equal(store.getBlock(cell00.id)!.inlines[0].text, 'A1');
      assert.equal(store.getBlock(cell11.id)!.inlines[0].text, 'B2');
    });

    it('should splitBlock inside a table cell', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      const newId = generateBlockId();
      store.splitBlock(cellBlockId, 3, newId, 'paragraph');
      // Original cell block should have "Hel"
      const before = store.getBlock(cellBlockId)!;
      assert.equal(before.inlines[0].text, 'Hel');
      // New block should have "lo"
      const after = store.getBlock(newId)!;
      assert.equal(after.inlines[0].text, 'lo');
      // Table still has 1 top-level block
      const doc = store.getDocument();
      assert.equal(doc.blocks.length, 1);
      // Cell now has 2 blocks
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.blocks.length, 2);
    });

    it('should mergeBlock inside a table cell', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      // Split first, then merge back
      const newId = generateBlockId();
      store.splitBlock(cellBlockId, 3, newId, 'paragraph');
      store.mergeBlock(cellBlockId, newId);
      // Should be back to one block with "Hello"
      const result = store.getBlock(cellBlockId)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'Hello');
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.blocks.length, 1);
    });

    it('should split and merge without affecting other cells', () => {
      const tableBlock = createTableBlock(2, 2);
      const cell00 = tableBlock.tableData!.rows[0].cells[0].blocks[0];
      const cell01 = tableBlock.tableData!.rows[0].cells[1].blocks[0];
      cell00.inlines = [{ text: 'Hello', style: {} }];
      cell01.inlines = [{ text: 'World', style: {} }];
      store.setDocument({ blocks: [tableBlock] });

      const newId = generateBlockId();
      store.splitBlock(cell00.id, 2, newId, 'paragraph');

      // cell00 split into 2 blocks
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].blocks.length, 2);
      // cell01 unchanged
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[1].blocks.length, 1);
      assert.equal(store.getBlock(cell01.id)!.inlines[0].text, 'World');
    });
  });

  describe('setBlockType', () => {
    it('should change block type to heading', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'heading', { headingLevel: 2 });
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'heading');
      assert.equal(result.headingLevel, 2);
      assert.equal(result.inlines[0].text, 'Hello');
    });

    it('should change heading to paragraph, clearing headingLevel', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'heading',
        inlines: [{ text: 'Title', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
        headingLevel: 1,
      };
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'paragraph');
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'paragraph');
      assert.equal(result.headingLevel, undefined);
    });

    it('should remove stale headingLevel from tree when changing to list-item', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'heading',
        inlines: [{ text: 'Title', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
        headingLevel: 2,
      };
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'list-item', { listKind: 'ordered', listLevel: 0 });
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'list-item');
      assert.equal(result.headingLevel, undefined, 'headingLevel should be removed');
      assert.equal(result.listKind, 'ordered');
    });

    it('should remove stale listKind/listLevel from tree when changing to paragraph', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'list-item',
        inlines: [{ text: 'Item', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
        listKind: 'unordered',
        listLevel: 1,
      };
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'paragraph');
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'paragraph');
      assert.equal(result.listKind, undefined, 'listKind should be removed');
      assert.equal(result.listLevel, undefined, 'listLevel should be removed');
    });

    it('should change heading level on existing heading', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'heading',
        inlines: [{ text: 'Title', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
        headingLevel: 1,
      };
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'heading', { headingLevel: 3 });
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'heading');
      assert.equal(result.headingLevel, 3);
    });

    it('should change to list-item with kind and level', () => {
      const block = makeBlock('Item');
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'list-item', { listKind: 'ordered', listLevel: 1 });
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'list-item');
      assert.equal(result.listKind, 'ordered');
      assert.equal(result.listLevel, 1);
    });

    it('should clear inlines for horizontal-rule', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'horizontal-rule');
      const result = store.getBlock(block.id)!;
      assert.equal(result.type, 'horizontal-rule');
      assert.equal(result.inlines.length, 0);
    });

    it('should work for cell-internal blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.setBlockType(cellBlockId, 'heading', { headingLevel: 3 });
      const result = store.getBlock(cellBlockId)!;
      assert.equal(result.type, 'heading');
      assert.equal(result.headingLevel, 3);
    });
  });

  describe('applyBlockStyle', () => {
    it('should apply alignment', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyBlockStyle(block.id, { alignment: 'center' });
      const result = store.getBlock(block.id)!;
      assert.equal(result.style.alignment, 'center');
      // Other defaults preserved
      assert.equal(result.style.lineHeight, DEFAULT_BLOCK_STYLE.lineHeight);
    });

    it('should merge with existing style', () => {
      const block = makeBlock('Hello', { alignment: 'right', marginTop: 10 });
      store.setDocument({ blocks: [block] });
      store.applyBlockStyle(block.id, { marginTop: 20 });
      const result = store.getBlock(block.id)!;
      assert.equal(result.style.alignment, 'right');
      assert.equal(result.style.marginTop, 20);
    });

    it('should work for cell-internal blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.applyBlockStyle(cellBlockId, { alignment: 'center' });
      const result = store.getBlock(cellBlockId)!;
      assert.equal(result.style.alignment, 'center');
    });
  });

  describe('applyCellStyle', () => {
    it('should apply background color to a cell', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.style.backgroundColor, '#ff0000');
    });

    it('should merge with existing cell style', () => {
      const tableBlock = createTableBlock(1, 1);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      store.applyCellStyle(tableBlock.id, 0, 0, { verticalAlign: 'middle' });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.style.backgroundColor, '#ff0000');
      assert.equal(cell.style.verticalAlign, 'middle');
    });

    it('should not affect other cells', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[1].style.backgroundColor, undefined);
      assert.equal(doc.blocks[0].tableData!.rows[1].cells[0].style.backgroundColor, undefined);
    });
  });

  describe('applyCellSpan', () => {
    it('should set colSpan on a cell', () => {
      const tableBlock = createTableBlock(2, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.colSpan, 2);
    });

    it('should set rowSpan on a cell', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 3 });
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan, 3);
    });

    it('should set both colSpan and rowSpan', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.colSpan, 2);
      assert.equal(cell.rowSpan, 2);
    });

    it('should remove colSpan when set to 1 (default)', () => {
      const tableBlock = createTableBlock(2, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 3 });
      assert.equal(store.getDocument().blocks[0].tableData!.rows[0].cells[0].colSpan, 3);
      // Setting to 1 removes it (default)
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1 });
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].colSpan, undefined);
    });

    it('should remove rowSpan when set to 1 (default)', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      assert.equal(store.getDocument().blocks[0].tableData!.rows[0].cells[0].rowSpan, 2);
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 1 });
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan, undefined);
    });

    it('should set colSpan=0 for covered cells', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 1, { colSpan: 0 });
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[1].colSpan, 0);
    });

    it('should not affect other cell properties', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.colSpan, 2);
      assert.equal(cell.style.backgroundColor, '#ff0000');
    });

    it('should only update specified span property', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 3 });
      // Update only rowSpan, colSpan should remain
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.colSpan, 2);
      assert.equal(cell.rowSpan, 2);
    });

    it('should clear both spans (splitCell scenario)', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 2 });
      // Simulate splitCell: clear both spans
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1, rowSpan: 1 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cell.colSpan, undefined);
      assert.equal(cell.rowSpan, undefined);
    });

    it('should decrement rowSpan (deleteRow scenario)', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 3 });
      // Simulate deleteRow: decrement rowSpan
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan, 2);
    });
  });

  describe('deleteRow with spanning cells', () => {
    it('should decrement rowSpan when deleting a row spanned by a cell above', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      // Set rowSpan=2 on cell (0,0) — spans rows 0-1
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      // Mark cell (1,0) as covered
      store.applyCellSpan(tableBlock.id, 1, 0, { colSpan: 0 });

      // Delete row 1 — rowSpan should shrink to 1 (removed)
      // Simulate Doc.deleteRow: adjust spans then delete row
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 1 });
      store.deleteTableRow(tableBlock.id, 1);

      const doc = store.getDocument();
      const td = doc.blocks[0].tableData!;
      assert.equal(td.rows.length, 2);
      assert.equal(td.rows[0].cells[0].rowSpan, undefined);
    });

    it('should decrement rowSpan from 3 to 2 when deleting a middle spanned row', () => {
      const tableBlock = createTableBlock(4, 2);
      store.setDocument({ blocks: [tableBlock] });
      // Set rowSpan=3 on cell (0,0) — spans rows 0-2
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 3 });

      // Delete row 1 — rowSpan should shrink to 2
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      store.deleteTableRow(tableBlock.id, 1);

      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows.length, 3);
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan, 2);
    });
  });

  describe('deleteColumn with spanning cells', () => {
    it('should decrement colSpan when deleting a column spanned by a cell to the left', () => {
      const tableBlock = createTableBlock(2, 3);
      store.setDocument({ blocks: [tableBlock] });
      // Set colSpan=2 on cell (0,0) — spans cols 0-1
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2 });
      store.applyCellSpan(tableBlock.id, 0, 1, { colSpan: 0 });

      // Delete col 1 — colSpan should shrink to 1 (removed)
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1 });
      store.deleteTableColumn(tableBlock.id, 1);

      const doc = store.getDocument();
      const td = doc.blocks[0].tableData!;
      assert.equal(td.rows[0].cells.length, 2);
      assert.equal(td.rows[0].cells[0].colSpan, undefined);
    });

    it('should decrement colSpan from 3 to 2 when deleting a middle spanned column', () => {
      const tableBlock = createTableBlock(2, 4);
      store.setDocument({ blocks: [tableBlock] });
      // Set colSpan=3 on cell (0,0) — spans cols 0-2
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 3 });

      // Delete col 1 — colSpan should shrink to 2
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2 });
      store.deleteTableColumn(tableBlock.id, 1);

      const doc = store.getDocument();
      assert.equal(doc.blocks[0].tableData!.rows[0].cells.length, 3);
      assert.equal(doc.blocks[0].tableData!.rows[0].cells[0].colSpan, 2);
    });
  });

  describe('splitCell via applyCellSpan', () => {
    it('should clear spans on top-left cell and restore covered cells', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });

      // Simulate merge: set colSpan=2, rowSpan=2 on top-left, mark covered cells
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 2 });
      store.applyCellSpan(tableBlock.id, 0, 1, { colSpan: 0 });
      store.applyCellSpan(tableBlock.id, 1, 0, { colSpan: 0 });
      store.applyCellSpan(tableBlock.id, 1, 1, { colSpan: 0 });

      // Verify merge state
      const merged = store.getDocument();
      assert.equal(merged.blocks[0].tableData!.rows[0].cells[0].colSpan, 2);
      assert.equal(merged.blocks[0].tableData!.rows[0].cells[0].rowSpan, 2);
      assert.equal(merged.blocks[0].tableData!.rows[0].cells[1].colSpan, 0);

      // Simulate splitCell: clear spans on all cells
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1, rowSpan: 1 });
      store.applyCellSpan(tableBlock.id, 0, 1, { colSpan: 1 });
      store.applyCellSpan(tableBlock.id, 1, 0, { colSpan: 1 });
      store.applyCellSpan(tableBlock.id, 1, 1, { colSpan: 1 });

      // All cells should have no span attributes
      const doc = store.getDocument();
      const td = doc.blocks[0].tableData!;
      assert.equal(td.rows[0].cells[0].colSpan, undefined);
      assert.equal(td.rows[0].cells[0].rowSpan, undefined);
      assert.equal(td.rows[0].cells[1].colSpan, undefined);
      assert.equal(td.rows[1].cells[0].colSpan, undefined);
      assert.equal(td.rows[1].cells[1].colSpan, undefined);
    });
  });

  describe('insertImageInline', () => {
    it('should insert an image inline at offset', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertImageInline(block.id, 3, {
        text: '\uFFFC',
        style: { image: { src: 'test.png', width: 100, height: 50 } },
      });
      const result = store.getBlock(block.id)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'Hel\uFFFClo');
      const imgInline = result.inlines.find((i) => i.style.image);
      assert.ok(imgInline, 'Image inline should exist');
      assert.equal(imgInline!.style.image!.src, 'test.png');
    });

    it('should insert image at beginning of block', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertImageInline(block.id, 0, {
        text: '\uFFFC',
        style: { image: { src: 'img.png', width: 50, height: 50 } },
      });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines[0].text, '\uFFFC');
      assert.ok(result.inlines[0].style.image);
    });

    it('should insert image at end of block without empty trailing inline', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertImageInline(block.id, 5, {
        text: '\uFFFC',
        style: { image: { src: 'end.png', width: 100, height: 50 } },
      });
      const result = store.getBlock(block.id)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'Hello\uFFFC');
      // No empty trailing inline should exist
      for (const il of result.inlines) {
        assert.ok(il.text.length > 0, `Inline should not be empty: "${il.text}"`);
      }
    });

    it('should work for cell-internal blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.insertImageInline(cellBlockId, 2, {
        text: '\uFFFC',
        style: { image: { src: 'cell.png', width: 80, height: 60 } },
      });
      const result = store.getBlock(cellBlockId)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.ok(fullText.includes('\uFFFC'), 'Image char should be present');
    });
  });

  describe('insertBlockAfter', () => {
    it('should insert a block after a top-level sibling', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });

      const newBlock = makeBlock('Inserted');
      store.insertBlockAfter(b1.id, newBlock);

      const result = store.getDocument();
      assert.equal(result.blocks.length, 3);
      assert.equal(result.blocks[0].inlines[0].text, 'First');
      assert.equal(result.blocks[1].inlines[0].text, 'Inserted');
      assert.equal(result.blocks[2].inlines[0].text, 'Second');
    });

    it('should insert a block after a cell-internal sibling', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cellBlockId = tableBlock.tableData!.rows[0].cells[0].blocks[0].id;
      const newBlock = makeBlock('CellInserted');
      store.insertBlockAfter(cellBlockId, newBlock);

      const result = store.getDocument();
      const cell = result.blocks[1].tableData!.rows[0].cells[0];
      assert.equal(cell.blocks.length, 2);
      assert.equal(cell.blocks[1].inlines[0].text, 'CellInserted');
    });

    it('should insert a block after a body sibling when header exists', () => {
      const b1 = makeBlock('Body1');
      const b2 = makeBlock('Body2');
      const headerBlock = makeBlock('Header');
      store.setDocument({
        blocks: [b1, b2],
        header: { blocks: [headerBlock], marginFromEdge: 48 },
      });

      const newBlock = makeBlock('Inserted');
      store.insertBlockAfter(b1.id, newBlock);

      const result = store.getDocument();
      assert.equal(result.blocks.length, 3);
      assert.equal(result.blocks[0].inlines[0].text, 'Body1');
      assert.equal(result.blocks[1].inlines[0].text, 'Inserted');
      assert.equal(result.blocks[2].inlines[0].text, 'Body2');
      // Header should be unchanged
      assert.equal(result.header!.blocks.length, 1);
      assert.equal(result.header!.blocks[0].inlines[0].text, 'Header');
    });

    it('should insert a table block after a cell-internal sibling', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cellBlockId = tableBlock.tableData!.rows[0].cells[0].blocks[0].id;
      const nestedTable = createTableBlock(2, 2);
      store.insertBlockAfter(cellBlockId, nestedTable);

      const result = store.getDocument();
      const cell = result.blocks[1].tableData!.rows[0].cells[0];
      assert.equal(cell.blocks.length, 2);
      assert.equal(cell.blocks[1].type, 'table');
      assert.equal(cell.blocks[1].tableData!.rows.length, 2);
    });
  });

  describe('deleteBlock (cell-internal)', () => {
    it('should delete a cell-internal block when multiple blocks exist', () => {
      const { tableBlock, doc } = makeTableDoc();
      // Add a second block to the cell
      const secondBlock = makeBlock('Second');
      tableBlock.tableData!.rows[0].cells[0].blocks.push(secondBlock);
      store.setDocument(doc);

      // Delete the first block
      const firstBlockId = tableBlock.tableData!.rows[0].cells[0].blocks[0].id;
      store.deleteBlock(firstBlockId);

      const result = store.getDocument();
      const cell = result.blocks[1].tableData!.rows[0].cells[0];
      assert.equal(cell.blocks.length, 1);
      assert.equal(cell.blocks[0].inlines[0].text, 'Second');
    });
  });
});
