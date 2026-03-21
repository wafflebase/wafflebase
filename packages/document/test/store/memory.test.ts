import { describe, it, expect } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { generateBlockId } from '../../src/model/types.js';

describe('MemDocStore', () => {
  function makeBlock(text: string) {
    return {
      id: generateBlockId(),
      type: 'paragraph' as const,
      inlines: [{ text, style: {} }],
      style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8 },
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
  });

  describe('undo/redo', () => {
    it('should undo a setDocument', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.setDocument({ blocks: [] });
      expect(store.getDocument().blocks).toHaveLength(0);

      store.undo();
      expect(store.getDocument().blocks).toHaveLength(1);
      expect(store.getDocument().blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should redo after undo', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.setDocument({ blocks: [] });
      store.undo();
      store.redo();
      expect(store.getDocument().blocks).toHaveLength(0);
    });

    it('should clear redo stack on new mutation', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.setDocument({ blocks: [] });
      store.undo();
      expect(store.canRedo()).toBe(true);

      const newBlock = makeBlock('New');
      store.insertBlock(0, newBlock);
      expect(store.canRedo()).toBe(false);
    });

    it('should report canUndo/canRedo correctly', () => {
      const store = new MemDocStore();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);

      store.setDocument({ blocks: [makeBlock('A')] });
      expect(store.canUndo()).toBe(true);
      expect(store.canRedo()).toBe(false);

      store.undo();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
    });

    it('should undo insertBlock', () => {
      const store = new MemDocStore();
      store.insertBlock(0, makeBlock('Hello'));
      expect(store.getDocument().blocks).toHaveLength(1);

      store.undo();
      expect(store.getDocument().blocks).toHaveLength(0);
    });

    it('should undo deleteBlock', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.deleteBlock(block.id);
      expect(store.getDocument().blocks).toHaveLength(0);

      store.undo();
      expect(store.getDocument().blocks).toHaveLength(1);
    });

    it('should undo updateBlock', () => {
      const block = makeBlock('Hello');
      const store = new MemDocStore({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');

      store.undo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });
  });
});
