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

  describe('setBlockType', () => {
    it('should change a paragraph to heading', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'heading', { headingLevel: 2 });
      expect(doc.document.blocks[0].type).toBe('heading');
      expect(doc.document.blocks[0].headingLevel).toBe(2);
    });

    it('should change a heading back to paragraph', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'heading', { headingLevel: 1 });
      doc.setBlockType(blockId, 'paragraph');
      expect(doc.document.blocks[0].type).toBe('paragraph');
      expect(doc.document.blocks[0].headingLevel).toBeUndefined();
    });

    it('should set list-item with kind and level', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'list-item', {
        listKind: 'ordered',
        listLevel: 1,
      });
      const block = doc.document.blocks[0];
      expect(block.type).toBe('list-item');
      expect(block.listKind).toBe('ordered');
      expect(block.listLevel).toBe(1);
    });

    it('should clear old type fields when changing type', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'list-item', {
        listKind: 'ordered',
        listLevel: 2,
      });
      doc.setBlockType(blockId, 'heading', { headingLevel: 3 });
      const block = doc.document.blocks[0];
      expect(block.headingLevel).toBe(3);
      expect(block.listKind).toBeUndefined();
      expect(block.listLevel).toBeUndefined();
    });
  });

  describe('splitBlock — type-aware', () => {
    it('should create paragraph when splitting a heading', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'heading', { headingLevel: 1 });
      doc.insertText({ blockId, offset: 0 }, 'Title');
      doc.splitBlock(blockId, 5);
      expect(doc.document.blocks[0].type).toBe('heading');
      expect(doc.document.blocks[1].type).toBe('paragraph');
    });

    it('should inherit list type when splitting list-item with content', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'list-item', {
        listKind: 'unordered',
        listLevel: 1,
      });
      doc.insertText({ blockId, offset: 0 }, 'Item');
      doc.splitBlock(blockId, 4);
      expect(doc.document.blocks[1].type).toBe('list-item');
      expect(doc.document.blocks[1].listKind).toBe('unordered');
      expect(doc.document.blocks[1].listLevel).toBe(1);
    });

    it('should convert empty list-item to paragraph (exit list)', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'list-item', {
        listKind: 'unordered',
        listLevel: 0,
      });
      const returnedId = doc.splitBlock(blockId, 0);
      expect(returnedId).toBe(blockId);
      expect(doc.document.blocks[0].type).toBe('paragraph');
      expect(doc.document.blocks).toHaveLength(1);
    });

    it('should create paragraph after horizontal-rule', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'horizontal-rule');
      const newId = doc.splitBlock(blockId, 0);
      expect(newId).not.toBe(blockId);
      expect(doc.document.blocks[1].type).toBe('paragraph');
    });

    it('should delete HR when backspacing from paragraph after it', () => {
      const doc = Doc.create();
      const firstId = doc.document.blocks[0].id;
      doc.setBlockType(firstId, 'horizontal-rule');
      // Split to create paragraph after HR
      const paraId = doc.splitBlock(firstId, 0);
      doc.insertText({ blockId: paraId, offset: 0 }, 'Hello');
      expect(doc.document.blocks).toHaveLength(2);
      // Backspace at start of paragraph should delete the HR
      doc.deleteBackward({ blockId: paraId, offset: 0 });
      expect(doc.document.blocks).toHaveLength(1);
      expect(doc.document.blocks[0].type).toBe('paragraph');
      expect(doc.document.blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should clear inlines when converting to horizontal-rule', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'text');
      doc.setBlockType(blockId, 'horizontal-rule');
      expect(doc.document.blocks[0].inlines).toHaveLength(0);
    });

    it('should restore empty inline when converting HR back to paragraph', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'horizontal-rule');
      expect(doc.document.blocks[0].inlines).toHaveLength(0);
      doc.setBlockType(blockId, 'paragraph');
      expect(doc.document.blocks[0].inlines).toHaveLength(1);
      expect(doc.document.blocks[0].inlines[0].text).toBe('');
    });
  });

  describe('page-break', () => {
    it('should create paragraph after page-break on splitBlock', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'page-break');
      const newId = doc.splitBlock(blockId, 0);
      expect(newId).not.toBe(blockId);
      expect(doc.document.blocks[1].type).toBe('paragraph');
    });

    it('should delete page-break when backspacing from paragraph after it', () => {
      const doc = Doc.create();
      const firstId = doc.document.blocks[0].id;
      doc.setBlockType(firstId, 'page-break');
      const paraId = doc.splitBlock(firstId, 0);
      doc.insertText({ blockId: paraId, offset: 0 }, 'Hello');
      doc.deleteBackward({ blockId: paraId, offset: 0 });
      expect(doc.document.blocks).toHaveLength(1);
      expect(doc.document.blocks[0].type).toBe('paragraph');
      expect(doc.document.blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should clear inlines when converting to page-break', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'text');
      doc.setBlockType(blockId, 'page-break');
      expect(doc.document.blocks[0].inlines).toHaveLength(0);
    });

    it('should restore empty inline when converting page-break back to paragraph', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'page-break');
      expect(doc.document.blocks[0].inlines).toHaveLength(0);
      doc.setBlockType(blockId, 'paragraph');
      expect(doc.document.blocks[0].inlines).toHaveLength(1);
    });
  });

  describe('superscript/subscript mutual exclusion', () => {
    it('should clear subscript when applying superscript', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      const range = {
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 5 },
      };
      doc.applyInlineStyle(range, { subscript: true });
      expect(doc.document.blocks[0].inlines[0].style.subscript).toBe(true);

      doc.applyInlineStyle(range, { superscript: true });
      expect(doc.document.blocks[0].inlines[0].style.superscript).toBe(true);
      expect(doc.document.blocks[0].inlines[0].style.subscript).toBeUndefined();
    });

    it('should clear superscript when applying subscript', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello');
      const range = {
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 5 },
      };
      doc.applyInlineStyle(range, { superscript: true });
      doc.applyInlineStyle(range, { subscript: true });
      expect(doc.document.blocks[0].inlines[0].style.subscript).toBe(true);
      expect(doc.document.blocks[0].inlines[0].style.superscript).toBeUndefined();
    });
  });

  describe('hyperlink', () => {
    it('should apply href to selected text', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'click here');
      const range = {
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 10 },
      };
      doc.applyInlineStyle(range, { href: 'https://example.com' });
      expect(doc.document.blocks[0].inlines[0].style.href).toBe('https://example.com');
    });

    it('should remove href by setting undefined', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'link');
      const range = {
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 4 },
      };
      doc.applyInlineStyle(range, { href: 'https://example.com' });
      doc.applyInlineStyle(range, { href: undefined });
      expect(doc.document.blocks[0].inlines[0].style.href).toBeUndefined();
    });
  });

  describe('searchText', () => {
    it('should find matches within a single block', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'hello world hello');
      const matches = doc.searchText('hello');
      expect(matches).toHaveLength(2);
      expect(matches[0]).toEqual({ blockId, startOffset: 0, endOffset: 5 });
      expect(matches[1]).toEqual({ blockId, startOffset: 12, endOffset: 17 });
    });

    it('should find matches across multiple blocks', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'hello');
      const newBlockId = doc.splitBlock(blockId, 5);
      doc.insertText({ blockId: newBlockId, offset: 0 }, 'hello again');
      const matches = doc.searchText('hello');
      expect(matches).toHaveLength(2);
    });

    it('should be case-insensitive by default', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello HELLO hello');
      const matches = doc.searchText('hello');
      expect(matches).toHaveLength(3);
    });

    it('should support case-sensitive search', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'Hello HELLO hello');
      const matches = doc.searchText('hello', { caseSensitive: true });
      expect(matches).toHaveLength(1);
      expect(matches[0].startOffset).toBe(12);
    });

    it('should support regex search', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'cat bat hat');
      const matches = doc.searchText('[cbh]at', { useRegex: true });
      expect(matches).toHaveLength(3);
    });

    it('should return empty array for no matches', () => {
      const doc = Doc.create();
      const matches = doc.searchText('xyz');
      expect(matches).toHaveLength(0);
    });

    it('should find match spanning inline boundaries', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'helloworld');
      doc.applyInlineStyle(
        { anchor: { blockId, offset: 0 }, focus: { blockId, offset: 5 } },
        { bold: true },
      );
      const matches = doc.searchText('lloworl');
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ blockId, startOffset: 2, endOffset: 9 });
    });
  });

  describe('applyBlockStyle', () => {
    it('should change paragraph alignment', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.applyBlockStyle(blockId, { alignment: 'center' });
      expect(doc.document.blocks[0].style.alignment).toBe('center');
    });

    it('should apply marginLeft to each block independently', () => {
      const doc = Doc.create();
      const block0 = doc.document.blocks[0];
      doc.insertText({ blockId: block0.id, offset: 0 }, 'first');
      const block1Id = doc.splitBlock(block0.id, 5);
      doc.insertText({ blockId: block1Id, offset: 0 }, 'second');

      doc.applyBlockStyle(block0.id, { marginLeft: 36 });
      doc.applyBlockStyle(block1Id, { marginLeft: 36 });

      expect(doc.document.blocks[0].style.marginLeft).toBe(36);
      expect(doc.document.blocks[1].style.marginLeft).toBe(36);
    });
  });
});
