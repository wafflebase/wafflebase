import { describe, it, beforeEach, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import { generateBlockId, DEFAULT_BLOCK_STYLE, createTableBlock, createTableCell } from '@wafflebase/docs';
import type { Block, Inline, TableRow, TableCell as TCell } from '@wafflebase/docs';

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
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].inlines[0].text).toBe('Hello');
      expect(result.blocks[0].id).toBe(block.id);
    });

    it('should handle empty document', () => {
      store.setDocument({ blocks: [] });
      expect(store.getDocument().blocks.length).toBe(0);
    });

    it('should handle multiple blocks', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      const result = store.getDocument();
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].inlines[0].text).toBe('First');
      expect(result.blocks[1].inlines[0].text).toBe('Second');
    });

    it('should preserve block styles', () => {
      const block = makeBlock('Centered', { alignment: 'center', lineHeight: 2.0 });
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      expect(result.blocks[0].style.alignment).toBe('center');
      expect(result.blocks[0].style.lineHeight).toBe(2.0);
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
      expect(result.blocks[0].inlines.length).toBe(2);
      expect(result.blocks[0].inlines[0].style.bold).toBe(true);
      expect(result.blocks[0].inlines[0].style.fontSize).toBe(14);
    });
  });

  describe('getBlock', () => {
    it('should find block by ID', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      const found = store.getBlock(block.id);
      expect(found).toBeTruthy();
      expect(found.inlines[0].text).toBe('Hello');
    });

    it('should return undefined for missing block', () => {
      expect(store.getBlock('nonexistent')).toBe(undefined);
    });
  });

  describe('updateBlock', () => {
    it('should update block content', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      const found = store.getBlock(block.id);
      expect(found).toBeTruthy();
      expect(found.inlines[0].text).toBe('World');
    });

    it('should throw for missing block', () => {
      expect(() => store.updateBlock('missing', makeBlock('x'))).toThrow(/Block not found/);
    });
  });

  describe('insertBlock', () => {
    it('should insert at the given index', () => {
      const b1 = makeBlock('First');
      store.setDocument({ blocks: [b1] });
      const b2 = makeBlock('Second');
      store.insertBlock(0, b2);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].inlines[0].text).toBe('Second');
      expect(result.blocks[1].inlines[0].text).toBe('First');
    });
  });

  describe('deleteBlock', () => {
    it('should delete by ID', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      store.deleteBlock(b1.id);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].id).toBe(b2.id);
    });

    it('should throw for missing block', () => {
      expect(() => store.deleteBlock('missing')).toThrow(/Block not found/);
    });
  });

  describe('deleteBlockByIndex', () => {
    it('should delete by index', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      store.deleteBlockByIndex(0);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].id).toBe(b2.id);
    });
  });

  describe('pageSetup', () => {
    it('should return defaults when not set', () => {
      const setup = store.getPageSetup();
      expect(setup.paperSize.name).toBe('Letter');
    });

    it('should set and get pageSetup', () => {
      store.setPageSetup({
        paperSize: { name: 'A4', width: 794, height: 1123 },
        orientation: 'portrait',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
      });
      const setup = store.getPageSetup();
      expect(setup.paperSize.name).toBe('A4');
      expect(setup.margins.top).toBe(72);
    });
  });

  describe('undo/redo (Yorkie history)', () => {
    it('should undo insertText', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertText(block.id, 5, ' World');
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello World');
      store.undo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });

    it('should redo after undo', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertText(block.id, 5, '!');
      store.undo();
      store.redo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello!');
    });

    it('applyStyle → undo → style removed', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true });
      expect(store.getBlock(block.id)?.inlines[0].style.bold).toBe(true);
      store.undo();
      const afterUndo = store.getBlock(block.id)!;
      const text = afterUndo.inlines.map((i) => i.text).join('');
      expect(text).toBe('Hello');
      expect(afterUndo.inlines[0].style.bold).not.toBe(true);
    });

    it('splitBlock → undo → blocks merged back', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      const newId = generateBlockId();
      store.splitBlock(block.id, 5, newId, 'paragraph');
      expect(store.getDocument().blocks.length).toBe(2);
      store.undo();
      const d = store.getDocument();
      expect(d.blocks.length).toBe(1);
      expect(d.blocks[0].inlines[0].text).toBe('HelloWorld');
    });

    // TODO(yorkie-undo): mergeBlock undo not yet supported by Yorkie Tree —
    // editByPath merge cannot be reversed. Re-enable when SDK supports it.
    it.skip('mergeBlock → undo → blocks restored', () => {
      const b1 = makeBlock('Hello');
      const b2 = makeBlock(' World');
      store.setDocument({ blocks: [b1, b2] });
      store.mergeBlock(b1.id, b2.id);
      expect(store.getDocument().blocks.length).toBe(1);
      store.undo();
      expect(store.getDocument().blocks.length).toBe(2);
    });

    it('multiple undos → redo all → original state restored', () => {
      const block = makeBlock('A');
      store.setDocument({ blocks: [block] });
      store.insertText(block.id, 1, 'B');
      store.insertText(block.id, 2, 'C');
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('ABC');
      store.undo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('AB');
      store.undo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('A');
      store.redo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('AB');
      store.redo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('ABC');
    });

    it('splitBlock → undo → redo round-trip', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });

      const newId = 'split-redo-test';
      store.splitBlock(block.id, 5, newId, 'paragraph');
      const afterSplit = store.getDocument();
      expect(afterSplit.blocks.length).toBe(2);
      expect(afterSplit.blocks[0].inlines[0].text).toBe('Hello');
      expect(afterSplit.blocks[1].inlines[0].text).toBe('World');

      store.undo();
      const afterUndo = store.getDocument();
      expect(afterUndo.blocks.length).toBe(1);
      expect(afterUndo.blocks[0].inlines[0].text).toBe('HelloWorld');

      store.redo();
      const afterRedo = store.getDocument();
      expect(
        afterRedo.blocks.length,
        `Expected 2 blocks, got ${afterRedo.blocks.length}`
      ).toBe(2);
      expect(afterRedo.blocks[0].inlines[0].text).toBe('Hello');
      expect(afterRedo.blocks[1].inlines[0].text).toBe('World');
    });

    // TODO(yorkie-undo): Yorkie SDK redo duplicates text inserted into
    // split-created blocks. The CRDT redo of block creation revives
    // text nodes that were independently undone, causing duplication
    // when the insertText redo fires.
    it.skip('splitBlock + insertText(new block) + undo all + redo all', () => {
      const block = makeBlock('asdf');
      store.setDocument({ blocks: [block] });
      const newBlockId = 'block-set-split';
      store.splitBlock(block.id, 4, newBlockId, 'paragraph');
      store.insertText(newBlockId, 0, 'xyz');
      while (store.canUndo()) store.undo();
      while (store.canRedo()) store.redo();
      const d = store.getDocument();
      expect(d.blocks.length).toBe(2);
      expect(d.blocks[0].inlines[0].text).toBe('asdf');
      expect(d.blocks[1].inlines[0].text).toBe('xyz');
    });

    it('insertText + splitBlock (no second insert) + undo all + redo all', () => {
      const block = makeBlock('');
      store.setDocument({ blocks: [block] });
      store.insertText(block.id, 0, 'asdf');
      store.splitBlock(block.id, 4, 'block-no-insert', 'paragraph');
      while (store.canUndo()) store.undo();
      while (store.canRedo()) store.redo();
      const d = store.getDocument();
      expect(d.blocks.length, `Expected 2, got ${d.blocks.length}`).toBe(2);
      expect(d.blocks[0].inlines[0].text).toBe('asdf');
      expect(d.blocks[1].inlines[0].text).toBe('');
    });

    it('canUndo/canRedo reflect Yorkie history state', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      // setDocument sets the undo floor — can't undo past initial load
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
      // After a mutation, canUndo should be true
      store.insertText(block.id, 5, '!');
      expect(store.canUndo()).toBe(true);
      store.undo();
      expect(store.canRedo()).toBe(true);
      // After undoing the mutation, can't undo past setDocument
      expect(store.canUndo()).toBe(false);
    });

    it('undo should restore cursor position via presence', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      // Simulate editor flow: updateCursorPos sets presence, then mutation
      store.updateCursorPos({ blockId: block.id, offset: 5 });
      store.setCursorForHistory({ blockId: block.id, offset: 5 });
      store.insertText(block.id, 5, ' World');
      store.undo();
      const restored = store.getPresenceCursorPos();
      expect(restored).toEqual({ blockId: block.id, offset: 5 });
    });

    it('redo should restore post-mutation cursor position via presence', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });
      store.setCursorForHistory({ blockId: block.id, offset: 5 });
      store.insertText(block.id, 5, ' World');
      store.undo();
      store.redo();
      const restored = store.getPresenceCursorPos();
      expect(restored).toEqual({ blockId: block.id, offset: 11 });
    });

    it('undo deleteText should restore cursor position', () => {
      const block = makeBlock('Hello World');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });
      store.setCursorForHistory({ blockId: block.id, offset: 5 });
      store.deleteText(block.id, 5, 6);
      store.undo();
      const restored = store.getPresenceCursorPos();
      expect(restored).toEqual({ blockId: block.id, offset: 5 });
    });

    it('undo splitBlock should restore cursor position', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });
      store.setCursorForHistory({ blockId: block.id, offset: 5 });
      const newId = 'new-block-for-cursor';
      store.splitBlock(block.id, 5, newId, 'paragraph');
      store.undo();
      const restored = store.getPresenceCursorPos();
      expect(restored).toEqual({ blockId: block.id, offset: 5 });
    });

    // Regression: ensureTree() in docs-view.tsx populates the Tree with an
    // initial block via doc.update() *before* YorkieDocStore is constructed.
    // When the doc already has blocks, editor.ts skips its setDocument
    // fallback, so undoFloor would stay at 0. Repeated undo could then
    // unwind ensureTree's update and destroy the initial block — leaving
    // the cursor pointing at a non-existent block id and crashing
    // text-editor.ts:handleInput with "Block not found".
    it('repeated undo cannot remove blocks present at construction', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seededDoc: any = new yorkie.Document<any>(`seed-${Date.now()}-${Math.random()}`);
      const initialId = `block-${Date.now()}-init`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      seededDoc.update((root: any) => {
        root.content = new yorkie.Tree({
          type: 'doc',
          children: [
            {
              type: 'block',
              attributes: {
                id: initialId,
                type: 'paragraph',
                alignment: 'left',
                lineHeight: '1.5',
                marginTop: '0',
                marginBottom: '8',
                textIndent: '0',
                marginLeft: '0',
              },
              children: [{ type: 'inline', children: [] }],
            },
          ],
        });
      });

      const seededStore = new YorkieDocStore(seededDoc);
      expect(seededStore.getDocument().blocks[0].id).toBe(initialId);

      // Simulate user typing "asdf" then Enter then "asdf" then Enter then "asdf",
      // matching the reported reproduction.
      seededStore.insertText(initialId, 0, 'asdf');
      const id2 = `block-${Date.now()}-2`;
      seededStore.splitBlock(initialId, 4, id2, 'paragraph');
      seededStore.insertText(id2, 0, 'asdf');
      const id3 = `block-${Date.now()}-3`;
      seededStore.splitBlock(id2, 4, id3, 'paragraph');
      seededStore.insertText(id3, 0, 'asdf');

      // Undo until the store says we cannot undo any further.
      let safety = 100;
      while (seededStore.canUndo() && safety-- > 0) {
        seededStore.undo();
      }

      // The initial block must still be reachable. Without the fix, the
      // ensureTree-style update is reachable via undo and the initial block
      // is destroyed.
      const blocks = seededStore.getDocument().blocks;
      expect(
        blocks.some((b) => b.id === initialId),
        `initial block ${initialId} must survive repeated undo, got ${JSON.stringify(blocks.map((b) => b.id))}`
      ).toBeTruthy();
    });
  });

  describe('applyStyle attribute removal', () => {
    // Re-read via a fresh store over the same doc to bypass the optimistic
    // cache and assert the CRDT Tree (source of truth) actually changed.
    const reread = (b: Block) =>
      new YorkieDocStore(doc).getBlock(b.id)!;

    it('clears href from the Tree when applyStyle gets { href: undefined }', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { href: 'https://example.com' });
      expect(reread(block).inlines[0].style.href).toBe('https://example.com');

      store.applyStyle(block.id, 0, 5, { href: undefined });
      expect(reread(block).inlines[0].style.href).toBeUndefined();
    });

    it('keeps other styles when only href is cleared', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true, href: 'https://example.com' });
      store.applyStyle(block.id, 0, 5, { href: undefined });
      const inline = reread(block).inlines[0];
      expect(inline.style.href).toBeUndefined();
      expect(inline.style.bold).toBe(true);
    });

    // Regression: editor.clearFormatting() calls applyStyle with every
    // inline format key set to `undefined`. The Yorkie store must tear
    // those attributes off the underlying Tree node — not just the
    // in-memory cache — or a peer / reload sees zombie attrs. Same class
    // of bug as 20260526-docs-unlink-href, but covering the broader key
    // set (fontFamily, fontSize, color, bold, ...).
    it('clearFormatting-style applyStyle({ ...: undefined }) removes attrs from the Tree', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      // Initial: bold + color + Roboto + 20pt + italic. We will clear
      // every key except `italic` to assert non-cleared keys survive.
      store.applyStyle(block.id, 0, 5, {
        bold: true,
        italic: true,
        color: '#ff0000',
        fontFamily: 'Roboto',
        fontSize: 20,
      });
      const initial = reread(block).inlines[0];
      expect(initial.style.bold).toBe(true);
      expect(initial.style.italic).toBe(true);
      expect(initial.style.color).toBe('#ff0000');
      expect(initial.style.fontFamily).toBe('Roboto');
      expect(initial.style.fontSize).toBe(20);

      // Same key set as editor.ts clearFormatting() minus `italic`.
      store.applyStyle(block.id, 0, 5, {
        bold: undefined,
        underline: undefined,
        strikethrough: undefined,
        fontSize: undefined,
        fontFamily: undefined,
        color: undefined,
        backgroundColor: undefined,
        superscript: undefined,
        subscript: undefined,
        href: undefined,
      });

      const cleared = reread(block).inlines[0];
      expect(cleared.style.bold).toBeUndefined();
      expect(cleared.style.fontSize).toBeUndefined();
      expect(cleared.style.fontFamily).toBeUndefined();
      expect(cleared.style.color).toBeUndefined();
      // Non-cleared key survives.
      expect(cleared.style.italic).toBe(true);
    });
  });

  describe('caching', () => {
    it('getDocument returns a deep clone (mutations do not affect store)', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      const doc = store.getDocument();
      doc.blocks[0].inlines[0].text = 'Mutated';
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Hello');
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
      expect(td.rows.length).toBe(3);
      expect(td.rows[0].cells[0].blocks[0].inlines[0].text).toBe('keep me');
      expect(td.rows[1].cells.length).toBe(2);
      expect(td.rows[2].cells[0].blocks[0].inlines[0].text).toBe('');
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
      expect(td.rows.length).toBe(1);
      expect(td.rows[0].cells[0].blocks[0].inlines[0].text).toBe('row 1');
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
      expect(td.rows[0].cells.length).toBe(3);
      expect(td.rows[1].cells.length).toBe(3);
    });
  });

  describe('deleteTableColumn', () => {
    it('should delete a column from every row', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      store.deleteTableColumn(tableBlock.id, 0);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      expect(td.rows[0].cells.length).toBe(1);
      expect(td.rows[1].cells.length).toBe(1);
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
      expect(td.rows[0].cells[0].blocks[0].inlines[0].text).toBe('updated 00');
      expect(td.rows[1].cells[1].blocks[0].inlines[0].text).toBe('original 11');
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
      expect(td.columnWidths).toEqual([0.7, 0.3]);
      expect(td.rows[0].cells[0].blocks[0].inlines[0].text).toBe('keep me');
    });
  });

  describe('granular table ops preserve surrounding blocks', () => {
    it('should not affect blocks before and after the table', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      store.insertTableRow(tableBlock.id, 1, { cells: [createTableCell(), createTableCell()] });

      const result = store.getDocument();
      expect(result.blocks[0].inlines[0].text).toBe('before');
      expect(result.blocks[2].inlines[0].text).toBe('after');
    });
  });

  describe('splitBlock', () => {
    it('should split a block at offset into two blocks', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-block-id', 'paragraph');
      const result = store.getDocument();
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].inlines[0].text).toBe('Hello');
      expect(result.blocks[1].inlines[0].text).toBe('World');
      expect(result.blocks[1].id).toBe('new-block-id');
      expect(result.blocks[1].type).toBe('paragraph');
    });

    it('should split at start — first block gets empty inline', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 0, 'new-id', 'paragraph');
      const result = store.getDocument();
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].inlines[0].text).toBe('');
      expect(result.blocks[1].inlines[0].text).toBe('Hello');
    });

    it('should split at end — second block gets empty inline', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].inlines[0].text).toBe('Hello');
      expect(result.blocks[1].inlines[0].text).toBe('');
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
      expect(result.blocks[1].inlines[0].text).toBe('World');
    });

    it('should allow insertText after splitting an empty block (double Enter)', () => {
      // Simulates: type "Hello" → Enter → Enter → type "World" in middle empty block
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });

      // First Enter: split at end of "Hello"
      store.splitBlock(block.id, 5, 'empty-block-1', 'paragraph');
      const step1 = store.getDocument();
      expect(step1.blocks.length).toBe(2);

      // Second Enter: split the empty block at offset 0
      store.splitBlock('empty-block-1', 0, 'empty-block-2', 'paragraph');
      const step2 = store.getDocument();
      expect(step2.blocks.length).toBe(3);

      // Now try to insert text into the first empty block (block index 1)
      // This must not throw "YorkieError: unacceptable path"
      store.insertText('empty-block-1', 0, 'World');
      const result = store.getDocument();
      expect(result.blocks[1].inlines[0].text).toBe('World');
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
      expect(result.blocks.length).toBe(2);
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
      expect(inlines.length, 'block should have no inline children').toBe(0);

      // This must not throw "YorkieError: unacceptable path"
      store.insertText(blockId, 0, 'Hello');
      const result = store.getDocument();
      expect(result.blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should preserve surrounding blocks', () => {
      const b1 = makeBlock('Before');
      const b2 = makeBlock('SplitMe');
      const b3 = makeBlock('After');
      store.setDocument({ blocks: [b1, b2, b3] });
      store.splitBlock(b2.id, 5, 'new-id', 'paragraph');
      const result = store.getDocument();
      expect(result.blocks.length).toBe(4);
      expect(result.blocks[0].inlines[0].text).toBe('Before');
      expect(result.blocks[1].inlines[0].text).toBe('Split');
      expect(result.blocks[2].inlines[0].text).toBe('Me');
      expect(result.blocks[3].inlines[0].text).toBe('After');
    });

    it('split at end of an image-only block does not duplicate the image in the Yorkie tree', () => {
      const blockId = generateBlockId();
      const block: Block = {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: '\uFFFC', style: { image: { src: 'img.png', width: 100, height: 80 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });

      store.splitBlock(blockId, 1, 'after-image', 'paragraph');

      // Pin the producer fix: the second <block>'s inline must have no
      // image.* attributes in the Yorkie tree itself. (The read-time filter
      // would otherwise mask a regression here.)
      const treeRoot = doc.getRoot().content.getRootTreeNode();
      const newBlockNode = treeRoot.children[1];
      const newInlines = (newBlockNode.children ?? []).filter(
        (c: { type: string }) => c.type === 'inline',
      );
      expect(newInlines.length, 'new block has exactly one inline').toBe(1);
      const treeAttrs = (newInlines[0].attributes ?? {}) as Record<string, string>;
      const treeImageKeys = Object.keys(treeAttrs).filter((k) => k.startsWith('image.'));
      expect(
        treeImageKeys,
        `new block inline must have no image.* attributes; saw ${treeImageKeys.join(', ')}`
      ).toEqual([]);

      // Read fresh through the filter to mirror a peer / reload view.
      const fresh = new YorkieDocStore(doc);
      const result = fresh.getDocument();
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].inlines[0].text).toBe('\uFFFC');
      expect(result.blocks[0].inlines[0].style.image, 'before block keeps image').toBeTruthy();
      expect(result.blocks[1].inlines[0].text).toBe('');
      expect(result.blocks[1].inlines[0].style.image).toBe(undefined);
    });

    it('split at end of a block whose last inline is an image preserves only one image', () => {
      const blockId = generateBlockId();
      const block: Block = {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: 'Hello', style: {} },
          { text: '\uFFFC', style: { image: { src: 'img.png', width: 100, height: 80 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });

      // offset 6 = end of "Hello" (5) + image (1)
      store.splitBlock(blockId, 6, 'after-image', 'paragraph');

      // Pin the producer fix at the tree level.
      const treeRoot = doc.getRoot().content.getRootTreeNode();
      const newBlockNode = treeRoot.children[1];
      const newInlines = (newBlockNode.children ?? []).filter(
        (c: { type: string }) => c.type === 'inline',
      );
      for (const inl of newInlines) {
        const attrs = (inl.attributes ?? {}) as Record<string, string>;
        const keys = Object.keys(attrs).filter((k) => k.startsWith('image.'));
        expect(keys, `new block inline must not carry image.*; saw ${keys.join(', ')}`).toEqual([]);
      }

      const fresh = new YorkieDocStore(doc);
      const result = fresh.getDocument();
      expect(result.blocks.length).toBe(2);
      const beforeImage = result.blocks[0].inlines.find((i) => i.style.image);
      expect(beforeImage, 'before block has the image').toBeTruthy();
      const afterImage = result.blocks[1].inlines.find((i) => i.style.image);
      expect(afterImage, 'after block must not duplicate the image style').toBe(undefined);
    });
  });

  describe('deleteText', () => {
    it('should keep at least one inline when deleting all text from a block with multiple empty inlines', () => {
      // Reproduce the production bug (server_seq=630):
      // 1. Block has 2 empty inlines (from split producing split fragments)
      // 2. Text is inserted into the first inline
      // 3. Text is deleted — cleanup loop should keep at least 1 inline
      const b1 = makeBlock('Hello');
      const b2 = makeBlock('World');
      store.setDocument({ blocks: [b1, b2] });

      // Split b1 at end → creates a new empty block between b1 and b2
      const newBlockId = generateBlockId();
      store.splitBlock(b1.id, 5, newBlockId, 'paragraph');

      // Now manually add a second empty inline to simulate split fragments
      // (production scenario: split on a block that already had an empty inline)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc.update((root: any) => {
        const tree = root.content;
        tree.editByPath([1, 1], [1, 1], {
          type: 'inline',
          attributes: {},
          children: [],
        });
      });

      // Verify the block now has 2 empty inlines in the Yorkie tree
      const treeBefore = doc.getRoot().content;
      const rootBefore = treeBefore.getRootTreeNode();
      const blockBefore = rootBefore.children[1];
      const inlinesBefore = (blockBefore.children || []).filter(
        (c: { type: string }) => c.type === 'inline',
      );
      expect(inlinesBefore.length, 'block should have 2 empty inlines').toBe(2);

      // Insert text into the block, then delete it
      store.insertText(newBlockId, 0, 'X');
      store.deleteText(newBlockId, 0, 1);

      // The block must still have at least 1 inline child
      const treeAfter = doc.getRoot().content;
      const rootAfter = treeAfter.getRootTreeNode();
      const blockAfter = rootAfter.children[1];
      const inlinesAfter = (blockAfter.children || []).filter(
        (c: { type: string }) => c.type === 'inline',
      );
      expect(
        inlinesAfter.length,
        `block should have exactly 1 inline, got ${inlinesAfter.length}`
      ).toBe(1);

      // getDocument should also work without errors
      const result = store.getDocument();
      expect(result.blocks[1].inlines.length).toBe(1);
    });
  });

  describe('mergeBlock', () => {
    it('should merge two adjacent blocks into one', () => {
      const b1 = makeBlock('Hello');
      const b2 = makeBlock(' World');
      store.setDocument({ blocks: [b1, b2] });
      store.mergeBlock(b1.id, b2.id);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].inlines[0].text).toBe('Hello World');
      expect(result.blocks[0].id).toBe(b1.id);
    });

    it('should preserve surrounding blocks', () => {
      const b1 = makeBlock('Before');
      const b2 = makeBlock('Hello');
      const b3 = makeBlock(' World');
      const b4 = makeBlock('After');
      store.setDocument({ blocks: [b1, b2, b3, b4] });
      store.mergeBlock(b2.id, b3.id);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(3);
      expect(result.blocks[0].inlines[0].text).toBe('Before');
      expect(result.blocks[1].inlines[0].text).toBe('Hello World');
      expect(result.blocks[2].inlines[0].text).toBe('After');
    });

    it('should throw when merging a block with itself', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      expect(() => store.mergeBlock(block.id, block.id)).toThrow(/Cannot merge/);
    });
  });

  describe('applyStyle', () => {
    it('should apply bold to a middle range', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 3, 8, { bold: true });
      const result = store.getBlock(block.id)!;
      expect(result.inlines.length).toBe(3);
      expect(result.inlines[0].text).toBe('Hel');
      expect(result.inlines[0].style.bold).toBe(undefined);
      expect(result.inlines[1].text).toBe('loWor');
      expect(result.inlines[1].style.bold).toBe(true);
      expect(result.inlines[2].text).toBe('ld');
      expect(result.inlines[2].style.bold).toBe(undefined);
    });

    it('should apply bold to block start', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 3, { bold: true });
      const result = store.getBlock(block.id)!;
      expect(result.inlines.length).toBe(2);
      expect(result.inlines[0].text).toBe('Hel');
      expect(result.inlines[0].style.bold).toBe(true);
      expect(result.inlines[1].text).toBe('lo');
      expect(result.inlines[1].style.bold).toBe(undefined);
    });

    it('should apply bold to block end', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 3, 5, { bold: true });
      const result = store.getBlock(block.id)!;
      expect(result.inlines.length).toBe(2);
      expect(result.inlines[0].text).toBe('Hel');
      expect(result.inlines[0].style.bold).toBe(undefined);
      expect(result.inlines[1].text).toBe('lo');
      expect(result.inlines[1].style.bold).toBe(true);
    });

    it('should apply bold to entire block', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true });
      const result = store.getBlock(block.id)!;
      expect(result.inlines.length).toBe(1);
      expect(result.inlines[0].text).toBe('Hello');
      expect(result.inlines[0].style.bold).toBe(true);
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
      expect(result.inlines.length).toBe(4);
      expect(result.inlines[0].text).toBe('Hel');
      expect(result.inlines[0].style.bold).toBe(true);
      expect(result.inlines[0].style.italic).toBe(undefined);
      expect(result.inlines[1].text).toBe('lo');
      expect(result.inlines[1].style.bold).toBe(true);
      expect(result.inlines[1].style.italic).toBe(true);
      expect(result.inlines[2].text).toBe('Wor');
      expect(result.inlines[2].style.italic).toBe(true);
      expect(result.inlines[3].text).toBe('ld');
      expect(result.inlines[3].style.italic).toBe(undefined);
    });

    it('should work correctly after text insert', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertText(block.id, 5, ' World');
      store.applyStyle(block.id, 6, 11, { bold: true });
      const result = store.getBlock(block.id)!;
      expect(result.inlines.length).toBe(2);
      expect(result.inlines[0].text).toBe('Hello ');
      expect(result.inlines[0].style.bold).toBe(undefined);
      expect(result.inlines[1].text).toBe('World');
      expect(result.inlines[1].style.bold).toBe(true);
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
      expect(fullText).toBe('Hello');
      // The first inline covering "Hel" should have bold:false (not true)
      expect(result.inlines[0].style.bold).toBe(false);
    });

    it('should preserve bold for text inserted inside bold region', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true });
      store.insertText(block.id, 3, 'XX');
      const result = store.getBlock(block.id)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      expect(fullText).toBe('HelXXlo');
      // All text should be bold since insertion inherits the inline style
      for (const inline of result.inlines) {
        expect(inline.style.bold, `"${inline.text}" should be bold`).toBe(true);
      }
    });
  });

  describe('split then merge round-trip', () => {
    it('should produce the original text after split then merge', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.splitBlock(block.id, 5, 'new-id', 'paragraph');
      const afterSplit = store.getDocument();
      expect(afterSplit.blocks.length).toBe(2);

      store.mergeBlock(afterSplit.blocks[0].id, afterSplit.blocks[1].id);
      const afterMerge = store.getDocument();
      expect(afterMerge.blocks.length).toBe(1);
      expect(afterMerge.blocks[0].inlines[0].text).toBe('HelloWorld');
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
      expect(result.blocks[0].inlines[0].text).toBe('Bold');
      expect(result.blocks[0].inlines[0].style.bold).toBe(true);
      expect(result.blocks[1].inlines[0].text).toBe('Normal');
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
      expect(result.blocks[0].inlines[0].text).toBe('Hello');
      expect(result.blocks[0].inlines[0].style.bold).toBe(true);
      expect(result.blocks[1].inlines[0].text).toBe('World');
      expect(
        result.blocks[1].inlines[0].style.bold,
        'bold style should be preserved on the right half after split'
      ).toBe(true);
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
      expect(
        afterInline.attributes?.bold,
        'Yorkie Tree node should have bold attribute after split'
      ).toBe('true');
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
      expect(result.blocks[1].inlines[0].text).toBe('World');
      expect(
        result.blocks[1].inlines[0].style.bold,
        'peer should see bold style after remote split'
      ).toBe(true);
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
      expect(result.blocks[1].inlines[0].text).toBe('World');
      expect(result.blocks[1].inlines[0].style.bold).toBe(true);
      expect(result.blocks[1].inlines[0].style.italic).toBe(true);
      expect(result.blocks[1].inlines[0].style.fontSize).toBe(18);
    });
  });

  describe('cache index with header offset', () => {
    it('splitBlock should not duplicate body content when header exists', () => {
      // When a header is present, tree path [1] maps to body blocks[0].
      // The cache update must use the body-relative index, not the tree path.
      const header = makeBlock('Header');
      const body = makeBlock('asdf');
      const trailing = makeBlock('');
      store.setDocument({ blocks: [body, trailing] });
      store.setHeader({ blocks: [header], marginFromEdge: 48 });

      store.splitBlock(body.id, 4, 'new-id', 'paragraph');
      const result = store.getDocument();
      expect(result.blocks.length).toBe(3);
      const text0 = result.blocks[0].inlines.map((i: Inline) => i.text).join('');
      const text1 = result.blocks[1].inlines.map((i: Inline) => i.text).join('');
      expect(text0, 'First body block should keep "asdf"').toBe('asdf');
      expect(text1, 'New block should be empty, not duplicated').toBe('');
    });

    it('mergeBlock should merge correct body blocks when header exists', () => {
      const header = makeBlock('Header');
      const b1 = makeBlock('Hello');
      const b2 = makeBlock('World');
      store.setDocument({ blocks: [b1, b2] });
      store.setHeader({ blocks: [header], marginFromEdge: 48 });

      store.mergeBlock(b1.id, b2.id);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(1);
      const text = result.blocks[0].inlines.map((i: Inline) => i.text).join('');
      expect(text).toBe('HelloWorld');
    });

    it('deleteBlock should delete correct body block when header exists', () => {
      const header = makeBlock('Header');
      const b1 = makeBlock('Keep');
      const b2 = makeBlock('Delete');
      store.setDocument({ blocks: [b1, b2] });
      store.setHeader({ blocks: [header], marginFromEdge: 48 });

      store.deleteBlock(b2.id);
      const result = store.getDocument();
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].inlines[0].text).toBe('Keep');
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
      expect(result.blocks[0].type).toBe('heading');
      expect(result.blocks[0].headingLevel).toBe(2);
      expect(result.blocks[1].type).toBe('paragraph');
      expect(result.blocks[1].headingLevel).toBe(undefined);
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
      expect(result.blocks[0].type).toBe('list-item');
      expect(result.blocks[0].listKind).toBe('ordered');
      expect(result.blocks[0].listLevel).toBe(1);
      expect(result.blocks[1].type).toBe('list-item');
      expect(result.blocks[1].listKind).toBe('ordered');
      expect(result.blocks[1].listLevel).toBe(1);
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
      expect(result.inlines[0].text).toBe('Hello World');
    });

    it('should deleteText from a table cell block', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.deleteText(cellBlockId, 0, 3);
      const result = store.getBlock(cellBlockId)!;
      expect(result.inlines[0].text).toBe('lo');
    });

    it('should insertText at middle of cell text', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.insertText(cellBlockId, 2, 'XX');
      const result = store.getBlock(cellBlockId)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      expect(fullText).toBe('HeXXllo');
    });

    it('should work with table preceded by other blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      const before = makeBlock('Before');
      store.setDocument({ blocks: [before, tableBlock] });
      store.insertText(cellBlockId, 5, '!');
      const result = store.getBlock(cellBlockId)!;
      expect(result.inlines[0].text).toBe('Hello!');
    });

    it('should applyStyle to a table cell block', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.applyStyle(cellBlockId, 0, 3, { bold: true });
      const result = store.getBlock(cellBlockId)!;
      expect(result.inlines[0].text).toBe('Hel');
      expect(result.inlines[0].style.bold).toBe(true);
      expect(result.inlines[1].text).toBe('lo');
      expect(result.inlines[1].style.bold).toBe(undefined);
    });

    it('should applyStyle after insertText in cell', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.insertText(cellBlockId, 5, ' World');
      store.applyStyle(cellBlockId, 6, 11, { italic: true });
      const result = store.getBlock(cellBlockId)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      expect(fullText).toBe('Hello World');
      expect(result.inlines[1].text).toBe('World');
      expect(result.inlines[1].style.italic).toBe(true);
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

      expect(store.getBlock(cell00.id)!.inlines[0].text).toBe('A1');
      expect(store.getBlock(cell11.id)!.inlines[0].text).toBe('B2');
    });

    it('should splitBlock inside a table cell', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      const newId = generateBlockId();
      store.splitBlock(cellBlockId, 3, newId, 'paragraph');
      // Original cell block should have "Hel"
      const before = store.getBlock(cellBlockId)!;
      expect(before.inlines[0].text).toBe('Hel');
      // New block should have "lo"
      const after = store.getBlock(newId)!;
      expect(after.inlines[0].text).toBe('lo');
      // Table still has 1 top-level block
      const doc = store.getDocument();
      expect(doc.blocks.length).toBe(1);
      // Cell now has 2 blocks
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.blocks.length).toBe(2);
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
      expect(fullText).toBe('Hello');
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.blocks.length).toBe(1);
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
      expect(doc.blocks[0].tableData!.rows[0].cells[0].blocks.length).toBe(2);
      // cell01 unchanged
      expect(doc.blocks[0].tableData!.rows[0].cells[1].blocks.length).toBe(1);
      expect(store.getBlock(cell01.id)!.inlines[0].text).toBe('World');
    });
  });

  describe('local caret anchoring', () => {
    it('resolves a body caret after upstream text is inserted', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });

      store.insertText(block.id, 0, 'Hey ');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: block.id, offset: 9 });
    });

    it('resolves a non-collapsed selection after upstream text is inserted', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos(
        { blockId: block.id, offset: 8 },
        {
          anchor: { blockId: block.id, offset: 2 },
          focus: { blockId: block.id, offset: 8 },
        },
      );

      store.insertText(block.id, 0, 'Hey ');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.selection, {
        anchor: { blockId: block.id, offset: 6 },
        focus: { blockId: block.id, offset: 12 },
        tableCellRange: undefined,
      });
    });

    it('resolves a header caret independently from body blocks', () => {
      const headerBlock = makeBlock('HeaderText');
      const bodyBlock = makeBlock('BodyText');
      store.setDocument({
        header: { blocks: [headerBlock], marginFromEdge: 48 },
        blocks: [bodyBlock],
      });
      store.updateCursorPos({ blockId: headerBlock.id, offset: 6 });

      store.insertText(headerBlock.id, 0, 'Top ');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: headerBlock.id, offset: 10 });
    });

    it('resolves a footer caret independently from body blocks', () => {
      const bodyBlock = makeBlock('BodyText');
      const footerBlock = makeBlock('FooterText');
      store.setDocument({
        blocks: [bodyBlock],
        footer: { blocks: [footerBlock], marginFromEdge: 48 },
      });
      store.updateCursorPos({ blockId: footerBlock.id, offset: 6 });

      store.insertText(footerBlock.id, 0, 'Low ');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: footerBlock.id, offset: 10 });
    });

    it('resolves a table-cell caret through nested tree paths', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.updateCursorPos({ blockId: cellBlockId, offset: 2 });

      store.insertText(cellBlockId, 0, 'Yo ');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: cellBlockId, offset: 5 });
    });

    it('round-trips a body DocPosition when nothing changes', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 4 });

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: block.id, offset: 4 });
    });

    it('leaves the resolved caret unchanged when text is inserted after it', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });

      store.insertText(block.id, 7, 'XYZ');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: block.id, offset: 5 });
    });

    it('keeps the local caret before text inserted at the same boundary', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });

      // Simulate a remote insert exactly at the anchored boundary.
      store.insertText(block.id, 5, 'X');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: block.id, offset: 5 });
    });

    it('shifts the resolved caret left when upstream text is deleted', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 8 });

      store.deleteText(block.id, 1, 3);

      const resolved = store.resolveAnchoredLocalCursor();
      assert.deepEqual(resolved.cursor, { blockId: block.id, offset: 5 });
    });

    it('clamps the resolved caret when the surrounding text is deleted', () => {
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 5 });

      store.deleteText(block.id, 2, 6);

      const resolved = store.resolveAnchoredLocalCursor();
      assert.equal(resolved.cursor!.blockId, block.id);
      const remaining = store.getBlock(block.id)!;
      const length = remaining.inlines.reduce((s, i) => s + i.text.length, 0);
      assert.ok(
        resolved.cursor!.offset >= 0 && resolved.cursor!.offset <= length,
        `caret offset ${resolved.cursor!.offset} out of [0,${length}]`,
      );
    });

    it('clamps to the surviving original block after a split deletes the anchored text', () => {
      // splitBlock uses delete+insert (not native Yorkie splitLevel=2) so an
      // anchor pointing into the deleted "after" portion no longer resolves
      // through CRDT semantics. Fallback clamps to the end of the surviving
      // original block, which keeps the caret visible without a crash.
      const block = makeBlock('HelloWorld');
      store.setDocument({ blocks: [block] });
      store.updateCursorPos({ blockId: block.id, offset: 7 });

      const newBlockId = generateBlockId();
      store.splitBlock(block.id, 5, newBlockId, 'paragraph');

      const resolved = store.resolveAnchoredLocalCursor();
      assert.equal(resolved.cursor!.blockId, block.id);
      assert.equal(resolved.cursor!.offset, 5);
    });

    it('falls back into the surviving region block after a merge removes the anchored block', () => {
      // mergeBlock also uses delete+insert, so an anchor inside the deleted
      // block falls through the deterministic ladder to the previous region
      // block's end. The logical offset is not preserved through the merge.
      const first = makeBlock('Hello');
      const second = makeBlock('World');
      store.setDocument({ blocks: [first, second] });
      store.updateCursorPos({ blockId: second.id, offset: 3 });

      store.mergeBlock(first.id, second.id);

      const resolved = store.resolveAnchoredLocalCursor();
      assert.equal(resolved.cursor!.blockId, first.id);
      const merged = store.getBlock(first.id)!;
      const mergedLength = merged.inlines.reduce((s, i) => s + i.text.length, 0);
      assert.equal(resolved.cursor!.offset, mergedLength);
    });

    it('falls back to the end of the previous region block when the anchor block is deleted', () => {
      const first = makeBlock('Hello');
      const second = makeBlock('World');
      store.setDocument({ blocks: [first, second] });
      store.updateCursorPos({ blockId: second.id, offset: 2 });

      store.deleteBlock(second.id);

      const resolved = store.resolveAnchoredLocalCursor();
      assert.equal(resolved.cursor!.blockId, first.id);
      assert.equal(resolved.cursor!.offset, 5);
    });
  });

  describe('setBlockType', () => {
    it('should change block type to heading', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'heading', { headingLevel: 2 });
      const result = store.getBlock(block.id)!;
      expect(result.type).toBe('heading');
      expect(result.headingLevel).toBe(2);
      expect(result.inlines[0].text).toBe('Hello');
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
      expect(result.type).toBe('paragraph');
      expect(result.headingLevel).toBe(undefined);
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
      expect(result.type).toBe('list-item');
      expect(result.headingLevel, 'headingLevel should be removed').toBe(undefined);
      expect(result.listKind).toBe('ordered');
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
      expect(result.type).toBe('paragraph');
      expect(result.listKind, 'listKind should be removed').toBe(undefined);
      expect(result.listLevel, 'listLevel should be removed').toBe(undefined);
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
      expect(result.type).toBe('heading');
      expect(result.headingLevel).toBe(3);
    });

    it('should change to list-item with kind and level', () => {
      const block = makeBlock('Item');
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'list-item', { listKind: 'ordered', listLevel: 1 });
      const result = store.getBlock(block.id)!;
      expect(result.type).toBe('list-item');
      expect(result.listKind).toBe('ordered');
      expect(result.listLevel).toBe(1);
    });

    it('should clear inlines for horizontal-rule', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.setBlockType(block.id, 'horizontal-rule');
      const result = store.getBlock(block.id)!;
      expect(result.type).toBe('horizontal-rule');
      expect(result.inlines.length).toBe(0);
    });

    it('should work for cell-internal blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.setBlockType(cellBlockId, 'heading', { headingLevel: 3 });
      const result = store.getBlock(cellBlockId)!;
      expect(result.type).toBe('heading');
      expect(result.headingLevel).toBe(3);
    });
  });

  describe('applyBlockStyle', () => {
    it('should apply alignment', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyBlockStyle(block.id, { alignment: 'center' });
      const result = store.getBlock(block.id)!;
      expect(result.style.alignment).toBe('center');
      // Other defaults preserved
      expect(result.style.lineHeight).toBe(DEFAULT_BLOCK_STYLE.lineHeight);
    });

    it('should merge with existing style', () => {
      const block = makeBlock('Hello', { alignment: 'right', marginTop: 10 });
      store.setDocument({ blocks: [block] });
      store.applyBlockStyle(block.id, { marginTop: 20 });
      const result = store.getBlock(block.id)!;
      expect(result.style.alignment).toBe('right');
      expect(result.style.marginTop).toBe(20);
    });

    it('should work for cell-internal blocks', () => {
      const { tableBlock, cellBlockId } = makeTableWithText();
      store.setDocument({ blocks: [tableBlock] });
      store.applyBlockStyle(cellBlockId, { alignment: 'center' });
      const result = store.getBlock(cellBlockId)!;
      expect(result.style.alignment).toBe('center');
    });
  });

  describe('applyCellStyle', () => {
    it('should apply background color to a cell', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.style.backgroundColor).toBe('#ff0000');
    });

    it('should merge with existing cell style', () => {
      const tableBlock = createTableBlock(1, 1);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      store.applyCellStyle(tableBlock.id, 0, 0, { verticalAlign: 'middle' });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.style.backgroundColor).toBe('#ff0000');
      expect(cell.style.verticalAlign).toBe('middle');
    });

    it('should not affect other cells', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      const doc = store.getDocument();
      expect(doc.blocks[0].tableData!.rows[0].cells[1].style.backgroundColor).toBe(undefined);
      expect(doc.blocks[0].tableData!.rows[1].cells[0].style.backgroundColor).toBe(undefined);
    });
  });

  describe('applyCellSpan', () => {
    it('should set colSpan on a cell', () => {
      const tableBlock = createTableBlock(2, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.colSpan).toBe(2);
    });

    it('should set rowSpan on a cell', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 3 });
      const doc = store.getDocument();
      expect(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan).toBe(3);
    });

    it('should set both colSpan and rowSpan', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.colSpan).toBe(2);
      expect(cell.rowSpan).toBe(2);
    });

    it('should remove colSpan when set to 1 (default)', () => {
      const tableBlock = createTableBlock(2, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 3 });
      expect(store.getDocument().blocks[0].tableData!.rows[0].cells[0].colSpan).toBe(3);
      // Setting to 1 removes it (default)
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1 });
      const doc = store.getDocument();
      expect(doc.blocks[0].tableData!.rows[0].cells[0].colSpan).toBe(undefined);
    });

    it('should remove rowSpan when set to 1 (default)', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      expect(store.getDocument().blocks[0].tableData!.rows[0].cells[0].rowSpan).toBe(2);
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 1 });
      const doc = store.getDocument();
      expect(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan).toBe(undefined);
    });

    it('should set colSpan=0 for covered cells', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 1, { colSpan: 0 });
      const doc = store.getDocument();
      expect(doc.blocks[0].tableData!.rows[0].cells[1].colSpan).toBe(0);
    });

    it('should not affect other cell properties', () => {
      const tableBlock = createTableBlock(2, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellStyle(tableBlock.id, 0, 0, { backgroundColor: '#ff0000' });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.colSpan).toBe(2);
      expect(cell.style.backgroundColor).toBe('#ff0000');
    });

    it('should only update specified span property', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 3 });
      // Update only rowSpan, colSpan should remain
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.colSpan).toBe(2);
      expect(cell.rowSpan).toBe(2);
    });

    it('should clear both spans (splitCell scenario)', () => {
      const tableBlock = createTableBlock(3, 3);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 2, rowSpan: 2 });
      // Simulate splitCell: clear both spans
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1, rowSpan: 1 });
      const doc = store.getDocument();
      const cell = doc.blocks[0].tableData!.rows[0].cells[0];
      expect(cell.colSpan).toBe(undefined);
      expect(cell.rowSpan).toBe(undefined);
    });

    it('should decrement rowSpan (deleteRow scenario)', () => {
      const tableBlock = createTableBlock(3, 2);
      store.setDocument({ blocks: [tableBlock] });
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 3 });
      // Simulate deleteRow: decrement rowSpan
      store.applyCellSpan(tableBlock.id, 0, 0, { rowSpan: 2 });
      const doc = store.getDocument();
      expect(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan).toBe(2);
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
      expect(td.rows.length).toBe(2);
      expect(td.rows[0].cells[0].rowSpan).toBe(undefined);
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
      expect(doc.blocks[0].tableData!.rows.length).toBe(3);
      expect(doc.blocks[0].tableData!.rows[0].cells[0].rowSpan).toBe(2);
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
      expect(td.rows[0].cells.length).toBe(2);
      expect(td.rows[0].cells[0].colSpan).toBe(undefined);
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
      expect(doc.blocks[0].tableData!.rows[0].cells.length).toBe(3);
      expect(doc.blocks[0].tableData!.rows[0].cells[0].colSpan).toBe(2);
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
      expect(merged.blocks[0].tableData!.rows[0].cells[0].colSpan).toBe(2);
      expect(merged.blocks[0].tableData!.rows[0].cells[0].rowSpan).toBe(2);
      expect(merged.blocks[0].tableData!.rows[0].cells[1].colSpan).toBe(0);

      // Simulate splitCell: clear spans on all cells
      store.applyCellSpan(tableBlock.id, 0, 0, { colSpan: 1, rowSpan: 1 });
      store.applyCellSpan(tableBlock.id, 0, 1, { colSpan: 1 });
      store.applyCellSpan(tableBlock.id, 1, 0, { colSpan: 1 });
      store.applyCellSpan(tableBlock.id, 1, 1, { colSpan: 1 });

      // All cells should have no span attributes
      const doc = store.getDocument();
      const td = doc.blocks[0].tableData!;
      expect(td.rows[0].cells[0].colSpan).toBe(undefined);
      expect(td.rows[0].cells[0].rowSpan).toBe(undefined);
      expect(td.rows[0].cells[1].colSpan).toBe(undefined);
      expect(td.rows[1].cells[0].colSpan).toBe(undefined);
      expect(td.rows[1].cells[1].colSpan).toBe(undefined);
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
      expect(fullText).toBe('Hel\uFFFClo');
      const imgInline = result.inlines.find((i) => i.style.image);
      expect(imgInline, 'Image inline should exist').toBeTruthy();
      expect(imgInline!.style.image!.src).toBe('test.png');
    });

    it('should insert image at beginning of block', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.insertImageInline(block.id, 0, {
        text: '\uFFFC',
        style: { image: { src: 'img.png', width: 50, height: 50 } },
      });
      const result = store.getBlock(block.id)!;
      expect(result.inlines[0].text).toBe('\uFFFC');
      expect(result.inlines[0].style.image).toBeTruthy();
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
      expect(fullText).toBe('Hello\uFFFC');
      // No empty trailing inline should exist
      for (const il of result.inlines) {
        expect(il.text.length > 0, `Inline should not be empty: "${il.text}"`).toBeTruthy();
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
      expect(fullText.includes('\uFFFC'), 'Image char should be present').toBeTruthy();
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
      expect(result.blocks.length).toBe(3);
      expect(result.blocks[0].inlines[0].text).toBe('First');
      expect(result.blocks[1].inlines[0].text).toBe('Inserted');
      expect(result.blocks[2].inlines[0].text).toBe('Second');
    });

    it('should insert a block after a cell-internal sibling', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cellBlockId = tableBlock.tableData!.rows[0].cells[0].blocks[0].id;
      const newBlock = makeBlock('CellInserted');
      store.insertBlockAfter(cellBlockId, newBlock);

      const result = store.getDocument();
      const cell = result.blocks[1].tableData!.rows[0].cells[0];
      expect(cell.blocks.length).toBe(2);
      expect(cell.blocks[1].inlines[0].text).toBe('CellInserted');
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
      expect(result.blocks.length).toBe(3);
      expect(result.blocks[0].inlines[0].text).toBe('Body1');
      expect(result.blocks[1].inlines[0].text).toBe('Inserted');
      expect(result.blocks[2].inlines[0].text).toBe('Body2');
      // Header should be unchanged
      expect(result.header!.blocks.length).toBe(1);
      expect(result.header!.blocks[0].inlines[0].text).toBe('Header');
    });

    it('should insert a table block after a cell-internal sibling', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cellBlockId = tableBlock.tableData!.rows[0].cells[0].blocks[0].id;
      const nestedTable = createTableBlock(2, 2);
      store.insertBlockAfter(cellBlockId, nestedTable);

      const result = store.getDocument();
      const cell = result.blocks[1].tableData!.rows[0].cells[0];
      expect(cell.blocks.length).toBe(2);
      expect(cell.blocks[1].type).toBe('table');
      expect(cell.blocks[1].tableData!.rows.length).toBe(2);
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
      expect(cell.blocks.length).toBe(1);
      expect(cell.blocks[0].inlines[0].text).toBe('Second');
    });
  });

});
