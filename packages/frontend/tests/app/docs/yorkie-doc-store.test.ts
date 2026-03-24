import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import { generateBlockId, DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';

function makeBlock(text: string, style?: Partial<Block['style']>): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE, ...style },
  };
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
});
