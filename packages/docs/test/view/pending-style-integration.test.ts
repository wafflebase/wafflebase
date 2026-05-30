import { describe, expect, it } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { Doc } from '../../src/model/document.js';
import { createEmptyBlock } from '../../src/model/types.js';
import { createPendingStyle, type PendingStyle } from '../../src/view/pending-style.js';

function makeDoc(text = '') {
  const store = new MemDocStore();
  const firstBlock = createEmptyBlock();
  store.setDocument({ blocks: [firstBlock] });
  const doc = new Doc(store);
  if (text) doc.insertText({ blockId: firstBlock.id, offset: 0 }, text);
  return { doc, blockId: firstBlock.id };
}

function typeAt(
  doc: Doc,
  pending: PendingStyle,
  pos: { blockId: string; offset: number },
  text: string,
) {
  const before = pos.offset;
  doc.insertText(pos, text);
  pending.consumeForInsert(pos.blockId, before, before + text.length);
  return { blockId: pos.blockId, offset: before + text.length };
}

function styleAt(doc: Doc, blockId: string, charIndex: number) {
  const block = doc.getBlock(blockId)!;
  let cursor = 0;
  for (const inline of block.inlines) {
    if (charIndex < cursor + inline.text.length) return inline.style;
    cursor += inline.text.length;
  }
  return block.inlines[block.inlines.length - 1]?.style ?? {};
}

describe('pending inline style — editor-level scenarios', () => {
  it('typing after a collapsed bold toggle styles the inserted run', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 0 });
    typeAt(doc, pending, { blockId, offset: 0 }, 'abc');
    expect(styleAt(doc, blockId, 0).bold).toBe(true);
    expect(styleAt(doc, blockId, 2).bold).toBe(true);
  });

  it('caret move via clear discards the pending style', () => {
    const { doc, blockId } = makeDoc('xy');
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 2 });
    pending.clear(); // simulating arrow-key handler
    typeAt(doc, pending, { blockId, offset: 2 }, 'a');
    expect(styleAt(doc, blockId, 2).bold).toBeFalsy();
  });

  it('rebindAnchor preserves pending across Enter block split', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ italic: true }, { blockId, offset: 0 });
    const newBlockId = doc.splitBlock(blockId, 0);
    pending.rebindAnchor(newBlockId);
    typeAt(doc, pending, { blockId: newBlockId, offset: 0 }, 'x');
    expect(styleAt(doc, newBlockId, 0).italic).toBe(true);
  });

  it('IME composing cycle applies style through rewindAnchor', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ color: '#ff0000' }, { blockId, offset: 0 });
    // Composing "ㅇ" at offset 0
    typeAt(doc, pending, { blockId, offset: 0 }, 'ㅇ');
    // Replace with "안" — text-editor pattern: rewind, delete, insert
    pending.rewindAnchor(blockId, 1);
    doc.deleteText({ blockId, offset: 0 }, 1);
    typeAt(doc, pending, { blockId, offset: 0 }, '안');
    // Commit "안녕" by appending "녕"
    typeAt(doc, pending, { blockId, offset: 1 }, '녕');
    expect(styleAt(doc, blockId, 0).color).toBe('#ff0000');
    expect(styleAt(doc, blockId, 1).color).toBe('#ff0000');
  });

  it('layered toggles accumulate after a committed character', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 0 });
    typeAt(doc, pending, { blockId, offset: 0 }, 'a');
    // Second toggle at the new caret merges italic on top of bold
    pending.set({ bold: true, italic: true }, { blockId, offset: 1 });
    typeAt(doc, pending, { blockId, offset: 1 }, 'b');
    expect(styleAt(doc, blockId, 0).bold).toBe(true);
    expect(styleAt(doc, blockId, 1).bold).toBe(true);
    expect(styleAt(doc, blockId, 1).italic).toBe(true);
  });

  it('anchor mismatch from an unrelated insert clears pending', () => {
    const { doc, blockId } = makeDoc('ab');
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 2 });
    // An unrelated insert (e.g. markdown auto-convert) fires at offset 0
    typeAt(doc, pending, { blockId, offset: 0 }, 'X');
    expect(pending.has()).toBe(false);
    expect(styleAt(doc, blockId, 0).bold).toBeFalsy();
  });
});
