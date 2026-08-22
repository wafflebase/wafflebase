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
