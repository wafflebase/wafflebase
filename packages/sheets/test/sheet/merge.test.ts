import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';

describe('Sheet.mergeSelection', () => {
  it('should merge selected cells and alias covered cells to anchor', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    expect(await sheet.mergeSelection()).toBe(true);
    expect(sheet.isSelectionMerged()).toBe(true);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('10');
  });

  it('should edit anchor when writing to a covered cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    await sheet.setData({ r: 1, c: 2 }, '42');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('42');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('42');
  });

  it('should recalculate formulas that reference covered cells after merge', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 1, c: 3 }, '=B1+1');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('3');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('6');
  });

  it('should unmerge selected merged range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    expect(await sheet.unmergeSelection()).toBe(true);
    expect(sheet.isSelectionMerged()).toBe(false);
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('');
  });
});

describe('Sheet merge + structural edits', () => {
  it('should expand merge when inserting rows inside merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'X');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    await sheet.mergeSelection();

    await sheet.insertRows(2, 1);
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('X');
  });

  it('should block move that would split merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, 'A');

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    await sheet.mergeSelection();

    await sheet.moveRows(2, 1, 5);
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('A');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('A');
  });
});

describe('Sheet merge + copy-paste', () => {
  it('should propagate a copied merged block to the paste destination', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    const { text } = await sheet.copy();
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(2);
    expect(merges.get('A1')).toEqual({ rs: 1, cs: 2 });
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('10');
  });

  it('should persist the propagated merge to the store', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    const { text } = await sheet.copy();
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const stored = await store.getMerges();
    expect(stored.get('A3')).toEqual({ rs: 1, cs: 2 });
  });

  it('should move the merged block on a cut-paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    const { text } = await sheet.cut();
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });

  it('should drop a merged block the paste fully covers', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 1, c: 3 }, '3');
    await sheet.setData({ r: 3, c: 2 }, '20');

    sheet.selectStart({ r: 3, c: 2 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    const { text } = await sheet.copy();
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('2');
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('3');
  });

  it('should refuse a paste that would split a merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 3, c: 2 }, '20');

    sheet.selectStart({ r: 3, c: 2 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();
    // A3:B3 would overwrite only the anchor half of the B3:C3 block.
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('B3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('20');
  });

  it('should keep the cut buffer when the paste is refused', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 3, c: 2 }, '20');

    sheet.selectStart({ r: 3, c: 2 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.cut();
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(sheet.isCutMode()).toBe(true);
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('1');
  });

  it('should clear destination cells the propagated merge hides', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 5, c: 4 }, 'ghost');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    const { text } = await sheet.copy();
    sheet.selectStart({ r: 5, c: 3 });
    await sheet.paste({ text });

    sheet.selectStart({ r: 5, c: 3 });
    await sheet.unmergeSelection();
    expect(await sheet.toDisplayString({ r: 5, c: 4 })).toBe('');
  });

  it('should recalculate dependants of a merge the paste dropped', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 2 }, '20');

    sheet.selectStart({ r: 3, c: 2 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    await sheet.setData({ r: 1, c: 4 }, '=C3+1');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('21');

    // A1:C1 holds a value in A1 only, so C3 is not written by the paste — it
    // stops aliasing B3 purely because the block is dropped.
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    const { text } = await sheet.copy();
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('1');
  });

  it('should write a single-cell paste through the merge anchor', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 4 }, '99');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 4 });
    const { text } = await sheet.copy();
    sheet.selectStart({ r: 1, c: 2 });
    await sheet.paste({ text });

    expect(sheet.getMerges().get('A1')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('99');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('99');
  });

  it('should drop a merged block a plain TSV paste fully covers', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.paste({ text: 'x\ty' });

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('x');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('y');
  });

  it('should refuse a plain TSV paste that would split a merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 2 });
    sheet.selectEnd({ r: 1, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.paste({ text: 'x\ty' });

    expect(sheet.getMerges().get('B1')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('20');
  });

  it('should paste plain cells when no merge is involved', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '7');

    const { text } = await sheet.copy();
    sheet.selectStart({ r: 3, c: 2 });
    await sheet.paste({ text });

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('7');
  });
});

describe('Sheet merge + drag-move', () => {
  it('should propagate the merge to the destination', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 2 },
      ],
      { r: 3, c: 1 },
    );

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('');
  });

  it('should replace a merge fully covered by the destination', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 1 }, '20');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 3 },
      ],
      { r: 3, c: 1 },
    );

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 3 });
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('10');
  });

  it('should persist the propagated merge to the store', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 2 },
      ],
      { r: 3, c: 1 },
    );

    const stored = await store.getMerges();
    expect(stored.size).toBe(1);
    expect(stored.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(stored.has('A1')).toBe(false);
  });

  it('should recalculate dependants of a merge the move removed', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 1 }, '20');

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    await sheet.setData({ r: 1, c: 4 }, '=B3+1');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('21');

    // A1:B1 fully covers the A3:B3 merge, so the merge is dropped and B3 stops
    // aliasing A3 — the dependant must not keep the aliased value.
    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 2 },
      ],
      { r: 3, c: 1 },
    );

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('1');
  });

  it('should clear destination cells covered by the moved merge', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 2 }, 'ghost');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 3 },
      ],
      { r: 3, c: 1 },
    );

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.unmergeSelection();
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('');
  });

  it('should not move a range that splits a merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      { r: 3, c: 1 },
    );

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A1')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
  });

  it('should not move onto a partially covered merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 3, c: 1 }, '20');

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      { r: 3, c: 1 },
    );

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('5');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('20');
  });

  it('should move plain cells when no merge is involved', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '7');

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      { r: 3, c: 2 },
    );

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });
});
