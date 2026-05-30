import { describe, expect, it, vi } from 'vitest';
import { createPendingStyle } from '../../src/view/pending-style.js';
import type { Doc } from '../../src/model/document.js';

function mockDoc() {
  return {
    applyInlineStyle: vi.fn(),
  } as unknown as Doc;
}

describe('PendingStyle', () => {
  it('is empty by default', () => {
    const p = createPendingStyle(mockDoc());
    expect(p.has()).toBe(false);
    expect(p.get()).toBeNull();
  });

  it('set stores style and anchor; get returns the style', () => {
    const p = createPendingStyle(mockDoc());
    p.set({ bold: true }, { blockId: 'b1', offset: 3 });
    expect(p.has()).toBe(true);
    expect(p.get()).toEqual({ bold: true });
  });

  it('clear removes state', () => {
    const p = createPendingStyle(mockDoc());
    p.set({ bold: true }, { blockId: 'b1', offset: 0 });
    p.clear();
    expect(p.has()).toBe(false);
    expect(p.get()).toBeNull();
  });

  it('consumeForInsert with matching anchor applies style and advances anchor', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 5 });
    p.consumeForInsert('b1', 5, 6);
    expect(doc.applyInlineStyle).toHaveBeenCalledWith(
      { anchor: { blockId: 'b1', offset: 5 }, focus: { blockId: 'b1', offset: 6 } },
      { bold: true },
    );
    p.consumeForInsert('b1', 6, 7);
    expect(doc.applyInlineStyle).toHaveBeenCalledTimes(2);
    expect(p.has()).toBe(true);
  });

  it('consumeForInsert with mismatched blockId is a no-op and clears state', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 5 });
    p.consumeForInsert('b2', 5, 6);
    expect(doc.applyInlineStyle).not.toHaveBeenCalled();
    expect(p.has()).toBe(false);
  });

  it('consumeForInsert with mismatched offset is a no-op and clears state', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 5 });
    p.consumeForInsert('b1', 6, 7);
    expect(doc.applyInlineStyle).not.toHaveBeenCalled();
    expect(p.has()).toBe(false);
  });

  it('rewindAnchor subtracts the given length, clamping at zero', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 3 });
    p.rewindAnchor('b1', 2);
    p.consumeForInsert('b1', 1, 2);
    expect(doc.applyInlineStyle).toHaveBeenCalled();
    p.set({ bold: true }, { blockId: 'b1', offset: 1 });
    p.rewindAnchor('b1', 5);
    p.consumeForInsert('b1', 0, 1);
    expect(doc.applyInlineStyle).toHaveBeenCalledTimes(2);
  });

  it('rewindAnchor on a non-matching block is a no-op', () => {
    const p = createPendingStyle(mockDoc());
    p.set({ bold: true }, { blockId: 'b1', offset: 3 });
    p.rewindAnchor('b2', 1);
    p.consumeForInsert('b1', 3, 4);
    expect(p.has()).toBe(true);
  });

  it('rebindAnchor moves anchor to a new block at offset 0 while keeping style', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ italic: true }, { blockId: 'b1', offset: 7 });
    p.rebindAnchor('b2');
    p.consumeForInsert('b2', 0, 1);
    expect(doc.applyInlineStyle).toHaveBeenCalledWith(
      { anchor: { blockId: 'b2', offset: 0 }, focus: { blockId: 'b2', offset: 1 } },
      { italic: true },
    );
  });

  it('rebindAnchor when nothing is pending is a no-op', () => {
    const p = createPendingStyle(mockDoc());
    p.rebindAnchor('b2');
    expect(p.has()).toBe(false);
  });
});
