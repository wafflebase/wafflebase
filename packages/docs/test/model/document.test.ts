import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { getBlockText } from '../../src/model/types.js';

describe('Doc', () => {
  describe('create', () => {
    it('should create a document with one empty paragraph', () => {
      const doc = Doc.create();
      expect(doc.document.blocks).toHaveLength(1);
      expect(doc.document.blocks[0].type).toBe('paragraph');
      expect(getBlockText(doc.document.blocks[0])).toBe('');
    });
  });

  describe('insertText', () => {
    it('should insert text at the beginning', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello');
    });

    it('should insert text in the middle', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Helo');
      doc.insertText({ blockId, offset: 2 }, 'l');
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello');
    });

    it('should insert text at the end', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      doc.insertText({ blockId, offset: 5 }, ' World');
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello World');
    });
  });

  describe('deleteText', () => {
    it('should delete text forward', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello World');
      doc.deleteText({ blockId, offset: 5 }, 6);
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello');
    });

    it('should delete a single character', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      doc.deleteText({ blockId, offset: 1 }, 1);
      expect(getBlockText(doc.document.blocks[0])).toBe('Hllo');
    });
  });

  describe('deleteBackward', () => {
    it('should delete the character before the cursor', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      const newPos = doc.deleteBackward({ blockId, offset: 5 });
      expect(getBlockText(doc.document.blocks[0])).toBe('Hell');
      expect(newPos.offset).toBe(4);
    });

    it('should do nothing at the start of the first block', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      const newPos = doc.deleteBackward({ blockId, offset: 0 });
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello');
      expect(newPos.offset).toBe(0);
    });

    it('should merge with previous block at start of block', () => {
      const doc = Doc.create();
      const firstBlockId = doc.document.blocks[0].id;
      doc.insertText({ blockId: firstBlockId, offset: 0 }, 'Hello');
      const secondBlockId = doc.splitBlock(firstBlockId, 5);
      doc.insertText({ blockId: secondBlockId, offset: 0 }, ' World');

      expect(doc.document.blocks).toHaveLength(2);

      const newPos = doc.deleteBackward({ blockId: secondBlockId, offset: 0 });
      expect(doc.document.blocks).toHaveLength(1);
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello World');
      expect(newPos.blockId).toBe(firstBlockId);
      expect(newPos.offset).toBe(5);
    });
  });

  describe('splitBlock', () => {
    it('should split a block at the given offset', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello World');
      const newBlockId = doc.splitBlock(blockId, 5);

      expect(doc.document.blocks).toHaveLength(2);
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello');
      expect(getBlockText(doc.document.blocks[1])).toBe(' World');
      expect(doc.document.blocks[1].id).toBe(newBlockId);
    });

    it('should split at the beginning (empty first block)', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      doc.splitBlock(blockId, 0);

      expect(doc.document.blocks).toHaveLength(2);
      expect(getBlockText(doc.document.blocks[0])).toBe('');
      expect(getBlockText(doc.document.blocks[1])).toBe('Hello');
    });

    it('should split at the end (empty second block)', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      doc.splitBlock(blockId, 5);

      expect(doc.document.blocks).toHaveLength(2);
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello');
      expect(getBlockText(doc.document.blocks[1])).toBe('');
    });
  });

  describe('mergeBlocks', () => {
    it('should merge two blocks', () => {
      const doc = Doc.create();
      const firstBlockId = doc.document.blocks[0].id;
      doc.insertText({ blockId: firstBlockId, offset: 0 }, 'Hello');
      const secondBlockId = doc.splitBlock(firstBlockId, 5);
      doc.insertText({ blockId: secondBlockId, offset: 0 }, ' World');

      doc.mergeBlocks(firstBlockId, secondBlockId);
      expect(doc.document.blocks).toHaveLength(1);
      expect(getBlockText(doc.document.blocks[0])).toBe('Hello World');
    });
  });

  describe('applyInlineStyle', () => {
    it('should apply bold to a range', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello World');

      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: 0 },
          focus: { blockId, offset: 5 },
        },
        { bold: true },
      );

      const block = doc.document.blocks[0];
      expect(block.inlines).toHaveLength(2);
      expect(block.inlines[0].text).toBe('Hello');
      expect(block.inlines[0].style.bold).toBe(true);
      expect(block.inlines[1].text).toBe(' World');
      expect(block.inlines[1].style.bold).toBeUndefined();
    });

    it('should apply style to middle of text', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello World');

      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: 2 },
          focus: { blockId, offset: 8 },
        },
        { italic: true },
      );

      const block = doc.document.blocks[0];
      expect(block.inlines).toHaveLength(3);
      expect(block.inlines[0].text).toBe('He');
      expect(block.inlines[1].text).toBe('llo Wo');
      expect(block.inlines[1].style.italic).toBe(true);
      expect(block.inlines[2].text).toBe('rld');
    });

    it('should merge adjacent inlines with same style', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'ABCDEF');

      // Bold the whole thing in two steps
      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: 0 },
          focus: { blockId, offset: 3 },
        },
        { bold: true },
      );
      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: 3 },
          focus: { blockId, offset: 6 },
        },
        { bold: true },
      );

      const block = doc.document.blocks[0];
      expect(block.inlines).toHaveLength(1);
      expect(block.inlines[0].text).toBe('ABCDEF');
      expect(block.inlines[0].style.bold).toBe(true);
    });

    it('should apply style across multiple blocks', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      const secondBlockId = doc.splitBlock(blockId, 5);
      doc.insertText({ blockId: secondBlockId, offset: 0 }, 'World');

      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: 3 },
          focus: { blockId: secondBlockId, offset: 3 },
        },
        { underline: true },
      );

      expect(doc.document.blocks[0].inlines[1].text).toBe('lo');
      expect(doc.document.blocks[0].inlines[1].style.underline).toBe(true);
      expect(doc.document.blocks[1].inlines[0].text).toBe('Wor');
      expect(doc.document.blocks[1].inlines[0].style.underline).toBe(true);
    });
  });

  describe('applyBlockStyle', () => {
    it('should change paragraph alignment', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.applyBlockStyle(blockId, { alignment: 'center' });
      expect(doc.document.blocks[0].style.alignment).toBe('center');
    });
  });
});
