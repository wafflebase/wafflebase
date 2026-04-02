import { describe, it, expect } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { generateBlockId, PAPER_SIZES, DEFAULT_PAGE_SETUP } from '../../src/model/types.js';

describe('MemDocStore', () => {
  function makeBlock(text: string) {
    return {
      id: generateBlockId(),
      type: 'paragraph' as const,
      inlines: [{ text, style: {} }],
      style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
    };
  }

  describe('basic operations', () => {
    it('should start with an empty document', () => {
      const store = new MemDocStore();
      expect(store.getDocument().blocks).toHaveLength(0);
    });

    it('should set and get a document', () => {
      const store = new MemDocStore();
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      expect(store.getDocument().blocks).toHaveLength(1);
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should get a block by ID', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });

    it('should return undefined for non-existent block', () => {
      const store = new MemDocStore();
      expect(store.getBlock('nonexistent')).toBeUndefined();
    });

    it('should update a block', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');
    });

    it('should insert a block at index', () => {
      const block1 = makeBlock('First');
      const store = new MemDocStore({ blocks: [block1] });
      const block2 = makeBlock('Second');
      store.insertBlock(0, block2);
      expect(store.getDocument().blocks).toHaveLength(2);
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Second');
      expect(store.getDocument().blocks[1].inlines[0].text).toBe('First');
    });

    it('should delete a block', () => {
      const block1 = makeBlock('First');
      const block2 = makeBlock('Second');
      const store = new MemDocStore({ blocks: [block1, block2] });
      store.deleteBlock(block1.id);
      expect(store.getDocument().blocks).toHaveLength(1);
      expect(store.getDocument().blocks[0].id).toBe(block2.id);
    });

    it('should delete a block by index', () => {
      const block1 = makeBlock('First');
      const block2 = makeBlock('Second');
      const store = new MemDocStore({ blocks: [block1, block2] });
      store.deleteBlockByIndex(0);
      expect(store.getDocument().blocks).toHaveLength(1);
      expect(store.getDocument().blocks[0].id).toBe(block2.id);
    });

    it('should throw for out-of-bounds index', () => {
      const store = new MemDocStore({ blocks: [makeBlock('Only')] });
      expect(() => store.deleteBlockByIndex(1)).toThrow('out of bounds');
      expect(() => store.deleteBlockByIndex(-1)).toThrow('out of bounds');
    });
  });

  describe('defensive cloning', () => {
    it('getDocument returns a deep clone', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      const doc = store.getDocument();
      doc.blocks[0].inlines[0].text = 'Mutated';
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Hello');
    });

    it('getBlock returns a deep clone', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      const got = store.getBlock(block.id)!;
      got.inlines[0].text = 'Mutated';
      expect(store.getBlock(block.id)!.inlines[0].text).toBe('Hello');
    });

    it('replaceDocument syncs without pushing undo', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      expect(store.canUndo()).toBe(false);

      store.replaceDocument({ blocks: [makeBlock('Replaced')] });
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Replaced');
      expect(store.canUndo()).toBe(false);
    });

    it('snapshot + replaceDocument enables correct undo', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });

      store.snapshot();
      store.replaceDocument({ blocks: [makeBlock('Edited')] });
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Edited');

      store.undo();
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Hello');
    });
  });

  describe('pageSetup', () => {
    it('getPageSetup returns DEFAULT_PAGE_SETUP when not set', () => {
      const store = new MemDocStore();
      expect(store.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
    });

    it('setPageSetup updates and supports undo', () => {
      const store = new MemDocStore();
      store.snapshot();
      const a4Setup = { ...DEFAULT_PAGE_SETUP, paperSize: PAPER_SIZES.A4 };
      store.setPageSetup(a4Setup);
      expect(store.getPageSetup().paperSize).toEqual(PAPER_SIZES.A4);

      store.undo();
      expect(store.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
    });
  });

  describe('undo/redo', () => {
    it('should undo a setDocument when preceded by snapshot', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.snapshot();
      store.setDocument({ blocks: [] });
      expect(store.getDocument().blocks).toHaveLength(0);

      store.undo();
      expect(store.getDocument().blocks).toHaveLength(1);
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should redo after undo', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.snapshot();
      store.setDocument({ blocks: [] });
      store.undo();
      store.redo();
      expect(store.getDocument().blocks).toHaveLength(0);
    });

    it('should clear redo stack on new snapshot', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.snapshot();
      store.setDocument({ blocks: [] });
      store.undo();
      expect(store.canRedo()).toBe(true);

      store.snapshot();
      const newBlock = makeBlock('New');
      store.insertBlock(0, newBlock);
      expect(store.canRedo()).toBe(false);
    });

    it('should report canUndo/canRedo correctly', () => {
      const store = new MemDocStore();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);

      store.snapshot();
      store.setDocument({ blocks: [makeBlock('A')] });
      expect(store.canUndo()).toBe(true);
      expect(store.canRedo()).toBe(false);

      store.undo();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
    });

    it('should undo insertBlock when preceded by snapshot', () => {
      const store = new MemDocStore();
      store.snapshot();
      store.insertBlock(0, makeBlock('Hello'));
      expect(store.getDocument().blocks).toHaveLength(1);

      store.undo();
      expect(store.getDocument().blocks).toHaveLength(0);
    });

    it('should undo deleteBlock when preceded by snapshot', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.snapshot();
      store.deleteBlock(block.id);
      expect(store.getDocument().blocks).toHaveLength(0);

      store.undo();
      expect(store.getDocument().blocks).toHaveLength(1);
    });

    it('should undo updateBlock when preceded by snapshot', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.snapshot();
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');

      store.undo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });

    it('mutation without snapshot is not undoable', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('fine-grained text editing', () => {
    it('insertText inserts at offset within block', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.insertText(block.id, 5, ' World');
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello World');
    });

    it('insertText at offset 0', () => {
      const block = makeBlock('World');
      const store = new MemDocStore({ blocks: [block] });
      store.insertText(block.id, 0, 'Hello ');
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello World');
    });

    it('deleteText removes characters at offset', () => {
      const block = makeBlock('Hello World');
      const store = new MemDocStore({ blocks: [block] });
      store.deleteText(block.id, 5, 6);
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });

    it('deleteText across inline boundaries', () => {
      const block = {
        id: 'b1',
        type: 'paragraph' as const,
        inlines: [
          { text: 'Hello', style: {} },
          { text: 'World', style: { bold: true } },
        ],
        style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
      };
      const store = new MemDocStore({ blocks: [block] });
      store.deleteText('b1', 3, 4);
      const updated = store.getBlock('b1')!;
      // "Hel" (no style) + "rld" (bold) — different styles, not merged
      expect(updated.inlines[0].text).toBe('Hel');
      expect(updated.inlines[1].text).toBe('rld');
    });

    it('insertText throws for non-existent block', () => {
      const store = new MemDocStore();
      expect(() => store.insertText('no-such', 0, 'X')).toThrow();
    });
  });

  describe('fine-grained styling', () => {
    it('applyStyle applies bold to range', () => {
      const block = makeBlock('Hello World');
      const store = new MemDocStore({ blocks: [block] });
      store.applyStyle(block.id, 6, 11, { bold: true });
      const updated = store.getBlock(block.id)!;
      expect(updated.inlines).toHaveLength(2);
      expect(updated.inlines[0].text).toBe('Hello ');
      expect(updated.inlines[1].text).toBe('World');
      expect(updated.inlines[1].style).toEqual({ bold: true });
    });

    it('applyStyle throws for non-existent block', () => {
      const store = new MemDocStore();
      expect(() => store.applyStyle('no-such', 0, 5, { bold: true })).toThrow();
    });
  });

  describe('structural editing', () => {
    it('splitBlock splits at offset', () => {
      const block = makeBlock('Hello World');
      const store = new MemDocStore({ blocks: [block] });
      store.splitBlock(block.id, 5, 'b2', 'paragraph');
      const doc = store.getDocument();
      expect(doc.blocks).toHaveLength(2);
      expect(doc.blocks[0].inlines[0].text).toBe('Hello');
      expect(doc.blocks[1].id).toBe('b2');
      expect(doc.blocks[1].inlines[0].text).toBe(' World');
    });

    it('mergeBlock merges and removes next', () => {
      const b1 = makeBlock('Hello');
      const b2 = makeBlock(' World');
      const store = new MemDocStore({ blocks: [b1, b2] });
      store.mergeBlock(b1.id, b2.id);
      const doc = store.getDocument();
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0].inlines[0].text).toBe('Hello World');
    });
  });
});
