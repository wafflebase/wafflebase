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

  it('should drop the copy buffer when rows are inserted', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 1 }, '10');

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    const { text } = await sheet.copy();
    expect(sheet.getCopyRange()).toEqual([
      { r: 3, c: 1 },
      { r: 3, c: 2 },
    ]);

    // The insert renumbers A3:B3 to A4:B4, so the buffer's source range and
    // merge snapshot now describe cells that moved. Relocating from them
    // would re-create the block from stale coordinates.
    await sheet.insertRows(1, 1);
    expect(sheet.getCopyRange()).toBeUndefined();

    // The clipboard text still pastes — as an external grid, with no merge.
    sheet.selectStart({ r: 8, c: 1 });
    await sheet.paste({ text });
    expect(sheet.getMerges().has('A8')).toBe(false);
    expect(await sheet.toDisplayString({ r: 8, c: 1 })).toBe('10');
  });

  it('should drop the copy buffer when rows are reordered', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 1 }, '10');

    sheet.selectStart({ r: 3, c: 1 });
    const { text } = await sheet.copy();

    await sheet.moveRows(3, 1, 8);
    expect(sheet.getCopyRange()).toBeUndefined();
    expect(text).toBe('10');
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

  it('should report why a range that splits a merged block is refused', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

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

    expect(refusals).toEqual(['merge-source-split']);
  });

  it('should report why a partially covered destination is refused', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 3, c: 1 }, '20');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

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

    expect(refusals).toEqual(['merge-dest-partial']);
  });

  it('should report nothing when the move goes through', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

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

    expect(refusals).toEqual([]);
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

describe('Sheet merge + copy-paste', () => {
  it('should re-create a copied merged block at the destination', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
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

  it('should persist the pasted merge to the store', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const stored = await store.getMerges();
    expect(stored.get('A3')).toEqual({ rs: 1, cs: 2 });
  });

  it('should drop a cut merged block at the source', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.cut();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });

  it('should drop a destination block the paste fully covers', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('20');
  });

  it('should recalculate dependants of a merge the paste removed', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    await sheet.setData({ r: 1, c: 4 }, '=B3+1');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('31');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    // A3:B3 is fully covered, so the merge is dropped and B3 stops aliasing
    // A3 — the dependant must read the pasted B3, not the old alias.
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(sheet.getMerges().size).toBe(0);
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('21');
  });

  it('should hide no stale data under a pasted merge', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 2 }, 'stale');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.unmergeSelection();
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('');
  });

  it('should refuse a paste that would split a destination block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 3, c: 2 }, '30');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 3, c: 2 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    // A3:B3 clips the B3:C3 block, so the whole paste is refused.
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(refusals).toEqual(['merge-paste-partial']);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('B3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('30');
  });

  it('should write a single-cell paste through the merge anchor', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 1 }, '30');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 2 });
    await sheet.paste({ text });

    expect(refusals).toEqual([]);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
  });

  it('should not refuse a cut whose destination clips its own block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 2 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 2, c: 2 });
    sheet.selectEnd({ r: 2, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 3 });
    const { text } = await sheet.cut();

    // A1:C3 pasted at C1 spans C1:E3, which clips the B2:C2 block — but the
    // cut deletes that block at the source, so nothing is split.
    sheet.selectStart({ r: 1, c: 3 });
    await sheet.paste({ text });

    expect(refusals).toEqual([]);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('D2')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 2, c: 4 })).toBe('10');
    // The block left the source with its content: nothing stale stays behind
    // in the region the cut vacated.
    expect(sheet.getMerges().get('B2')).toBeUndefined();
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('');
  });

  it('should refuse a cut that clips a block it does not move', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 2 }, '20');
    await sheet.setData({ r: 3, c: 3 }, '30');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 3, c: 3 });
    sheet.selectEnd({ r: 3, c: 4 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    const { text } = await sheet.cut();

    // A3:B3 pasted at B3 spans B3:C3, which clips the C3:D3 block. That block
    // is not part of the cut, so nothing deletes it and the paste is refused.
    sheet.selectStart({ r: 3, c: 2 });
    await sheet.paste({ text });

    expect(refusals).toEqual(['merge-paste-partial']);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('C3')).toEqual({ rs: 1, cs: 2 });
    // The refusal is whole: the cut source still holds its content.
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('30');
  });

  it('should refuse a cut whose recorded block was unmerged before pasting', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    const { text } = await sheet.cut();

    // The layout is edited under the clipboard: A3 now anchors a wider block
    // than the one the cut recorded, so the cut no longer removes it and it
    // must be treated like any other destination block.
    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.unmergeSelection();
    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(refusals).toEqual(['merge-paste-partial']);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 3 });
  });

  it('should refuse a paste that lands a block across a frozen row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 0);
    await sheet.setData({ r: 5, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 5, c: 1 });
    sheet.selectEnd({ r: 6, c: 1 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 5, c: 1 });
    sheet.selectEnd({ r: 6, c: 1 });
    const { text } = await sheet.copy();

    // A5:A6 pasted at A2 would span A2:A3, straddling the frozen-row boundary
    // — a block `canMergeSelection` would never let the user create there.
    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });

    expect(refusals).toEqual(['merge-paste-frozen']);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A5')).toEqual({ rs: 2, cs: 1 });
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
  });

  it('should keep a destination block when a blank range is pasted', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 1 }, '30');

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
  });

  it('should leave the merge layout alone on an external paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 2 }, '30');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 3, c: 2 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    // A foreign grid carries no merge metadata: the paste writes its values
    // and reports nothing, exactly as before.
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text: '1\t2' });

    expect(refusals).toEqual([]);
    expect(sheet.getMerges().get('B3')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('1');
  });
});

describe('Sheet merge and the freeze boundary', () => {
  it('should refuse a drag-move that lands a block across a frozen row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 0);
    await sheet.setData({ r: 5, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 5, c: 1 });
    sheet.selectEnd({ r: 6, c: 1 });
    await sheet.mergeSelection();

    // A5:A6 dropped at A2 would span A2:A3, straddling the frozen-row
    // boundary — the block `planPasteMerges` refuses on the paste path and
    // `canMergeSelection` would never let the user create with the button.
    await sheet.moveRangeTo(
      [
        { r: 5, c: 1 },
        { r: 6, c: 1 },
      ],
      { r: 2, c: 1 },
    );

    expect(refusals).toEqual(['merge-move-frozen']);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A5')).toEqual({ rs: 2, cs: 1 });
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
  });

  it('should allow a drag-move that stays on one side of the boundary', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 0);
    await sheet.setData({ r: 5, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 5, c: 1 });
    sheet.selectEnd({ r: 6, c: 1 });
    await sheet.mergeSelection();

    await sheet.moveRangeTo(
      [
        { r: 5, c: 1 },
        { r: 6, c: 1 },
      ],
      { r: 7, c: 1 },
    );

    expect(refusals).toEqual([]);
    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A7')).toEqual({ rs: 2, cs: 1 });
    expect(await sheet.toDisplayString({ r: 7, c: 1 })).toBe('10');
  });

  it('should snap the freeze past a block it would cut in half', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, '10');

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();

    // Freezing row 2 would leave A2:A4 straddling the boundary — the state
    // the paste and drag-move paths refuse to create. The line snaps to the
    // bottom of the block instead.
    await sheet.setFreezePane(2, 0);
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 4, frozenCols: 0 });

    // And the block is now movable again, which a straddling one never is.
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));
    await sheet.moveRangeTo(
      [
        { r: 2, c: 1 },
        { r: 4, c: 1 },
      ],
      { r: 6, c: 1 },
    );
    expect(refusals).toEqual([]);
    expect(sheet.getMerges().get('A6')).toEqual({ rs: 3, cs: 1 });
  });

  it('should carry a frozen block down with an insert above it', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, '10');

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();
    await sheet.setFreezePane(2, 0);
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 4, frozenCols: 0 });

    // The insert lands inside the frozen region, so the pre-existing boundary
    // adjustment moves the line and the block down by one together and the
    // block stays whole on the frozen side — no snapping needed.
    await sheet.insertRows(1, 1);
    expect(sheet.getMerges().get('A3')).toEqual({ rs: 3, cs: 1 });
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 5, frozenCols: 0 });
  });

  it('should snap the freeze past a straddling block after an insert', async () => {
    // A block already across the boundary is a state this replica cannot
    // create — `setFreezePane` snaps and every block-moving path refuses — but
    // a peer or the v1 settings API can write one into the document, and it
    // arrives here through the load path. Seed it the same way.
    const store = new MemStore();
    await store.setMerge({ r: 3, c: 1 }, { rs: 3, cs: 1 });
    await store.setFreezePane(3, 0);

    const sheet = new Sheet(store);
    await sheet.loadMerges();
    await sheet.loadFreezePane();
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 3, frozenCols: 0 });

    // The insert moves the boundary to 4 and the block to A4:A6, which still
    // straddles — the boundary adjustment alone does not repair it. The snap
    // inside `shiftCells` pushes the line to the bottom of the block.
    await sheet.insertRows(1, 1);
    expect(sheet.getMerges().get('A4')).toEqual({ rs: 3, cs: 1 });
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 6, frozenCols: 0 });
    // Persisted, not just repaired in memory.
    expect(await store.getFreezePane()).toEqual({
      frozenRows: 6,
      frozenCols: 0,
    });
  });

  it('should snap the freeze past a straddling block on the column axis', async () => {
    const store = new MemStore();
    await store.setMerge({ r: 1, c: 2 }, { rs: 1, cs: 3 });
    await store.setFreezePane(0, 2);

    const sheet = new Sheet(store);
    await sheet.loadMerges();
    await sheet.loadFreezePane();

    // Inserting a column inside the frozen band moves the line to 3 and the
    // block to C1:E1, which still straddles it.
    await sheet.insertColumns(1, 1);
    expect(sheet.getMerges().get('C1')).toEqual({ rs: 1, cs: 3 });
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 0, frozenCols: 5 });
  });

  it('should cascade the freeze snap through a chain of blocks', async () => {
    const sheet = new Sheet(new MemStore());

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();
    sheet.selectStart({ r: 4, c: 2 });
    sheet.selectEnd({ r: 7, c: 2 });
    await sheet.mergeSelection();

    // Freezing row 2 cuts A2:A4, so the line moves to 4 — which now cuts
    // B4:B7, so it moves again. One pass would have stopped at 4.
    await sheet.setFreezePane(2, 0);
    expect(sheet.getFreezePane()).toEqual({ frozenRows: 7, frozenCols: 0 });
  });

  it('should refuse a row reorder that lands a block across the boundary', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 0);
    await sheet.setData({ r: 5, c: 1 }, '10');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 5, c: 1 });
    sheet.selectEnd({ r: 6, c: 1 });
    await sheet.mergeSelection();

    // Reordering rows 5-6 to before row 2 would park A5:A6 at A2:A3, across
    // the frozen boundary — the same state the drag-move path refuses.
    await sheet.moveRows(5, 2, 2);

    expect(refusals).toEqual(['merge-move-frozen']);
    expect(sheet.getMerges().get('A5')).toEqual({ rs: 2, cs: 1 });
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('10');
  });
});

describe('Sheet.paste destination normalization', () => {
  it('should paste into the anchor when the active cell is covered', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '99');

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 3 });
    const { text } = await sheet.copy();

    // `selectRow` puts the active cell at the head of the row without
    // normalizing it, so row 3 leaves it on A3 — a cell the A2:A4 block
    // covers. Writing the pasted value there would hide it under the block
    // until an unmerge brought it back.
    sheet.selectRow(3);
    await sheet.paste({ text });

    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('99');

    // Unmerging is what would expose a value written to the covered cell.
    sheet.selectStart({ r: 2, c: 1 });
    await sheet.unmergeSelection();
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
  });

  it('should paste an external grid from the anchor too', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, '20');

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();

    sheet.selectRow(3);
    await sheet.paste({ text: '7' });

    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('7');

    sheet.selectStart({ r: 2, c: 1 });
    await sheet.unmergeSelection();
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
  });

  it('should keep the copy buffer when a paste is refused', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 3, c: 1 }, '30');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();
    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.cut();

    // The paste would split the wider A3:C3 block, so it is refused whole.
    // The cut has to survive it: the user unmerges and pastes again.
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });
    expect(sheet.getCopyRange()).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 2 },
    ]);
    expect(sheet.isCutMode()).toBe(true);

    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 3 });
    await sheet.unmergeSelection();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(1);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(sheet.getCopyRange()).toBeUndefined();
  });

  it('should propagate merges on a second paste from the same copy', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    // A copy pastes as many times as the user asks, and every paste carries
    // the same layout: the view no longer drops the buffer after the first.
    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });
    sheet.selectStart({ r: 5, c: 1 });
    await sheet.paste({ text });

    const merges = sheet.getMerges();
    expect(merges.size).toBe(3);
    expect(merges.get('A3')).toEqual({ rs: 1, cs: 2 });
    expect(merges.get('A5')).toEqual({ rs: 1, cs: 2 });
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('10');
  });

  it('should not shift a multi-cell paste off the selected row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 8, c: 1 }, 'x');
    await sheet.setData({ r: 8, c: 2 }, 'y');
    await sheet.setData({ r: 8, c: 3 }, 'z');
    const refusals: Array<string> = [];
    sheet.setOnRefusal((refusal) => refusals.push(refusal));

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 8, c: 1 });
    sheet.selectEnd({ r: 8, c: 3 });
    const { text } = await sheet.copy();

    // `selectRow(3)` leaves the active cell on A3, which A2:A4 covers. Only a
    // single-cell paste moves to the anchor; sliding a whole row up to row 2
    // would write over cells the user never selected. The row the user did
    // select cuts the block in half, so the paste is refused instead.
    sheet.selectRow(3);
    await sheet.paste({ text });

    expect(refusals).toEqual(['merge-paste-partial']);
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('');
    expect(await sheet.toDisplayString({ r: 2, c: 3 })).toBe('');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('20');
  });

  it('should not shift a multi-cell external paste off the selected row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, '20');

    sheet.selectStart({ r: 2, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.mergeSelection();

    // A3 is covered by A2:A4, so the old normalization moved the whole grid up
    // to row 2: it overwrote the block's own anchor with 'x' and wrote 'y'
    // into B2, a cell nothing selected.
    sheet.selectRow(3);
    await sheet.paste({ text: 'x\ty' });

    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('y');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('20');
  });

  it('should select the whole pasted region when a block is re-created', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 3 });
    await sheet.mergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 3 });
    const { text } = await sheet.copy();

    // The pasted grid holds only the anchor — the covered cells carry nothing
    // — so its bounding box is one cell. The selection has to cover the block
    // the paste actually re-created.
    sheet.selectStart({ r: 5, c: 1 });
    await sheet.paste({ text });

    expect(sheet.getMerges().get('A5')).toEqual({ rs: 2, cs: 3 });
    expect(sheet.getRange()).toEqual([
      { r: 5, c: 1 },
      { r: 6, c: 3 },
    ]);
  });
});

describe('Sheet copy-buffer lifetime', () => {
  it('should report whether a row reorder actually happened', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 0);
    await sheet.setData({ r: 5, c: 1 }, '10');

    sheet.selectStart({ r: 5, c: 1 });
    sheet.selectEnd({ r: 6, c: 1 });
    await sheet.mergeSelection();

    // Refused: A5:A6 would land at A2:A3, across the frozen boundary. The
    // caller has to be able to tell that from success — the drag-reorder
    // handler re-selects the drop position only when the rows moved.
    expect(await sheet.moveRows(5, 2, 2)).toBe(false);
    expect(await sheet.moveRows(5, 2, 8)).toBe(true);
    expect(sheet.getMerges().get('A6')).toEqual({ rs: 2, cs: 1 });
  });

  it('should drop the copy buffer on undo and redo', async () => {
    // MemStore has no history, so stand in a store whose undo/redo succeed:
    // what is under test is the sheet dropping the buffer, not the replay.
    class HistoryStore extends MemStore {
      override async undo(): Promise<{ success: boolean }> {
        return { success: true };
      }
      override async redo(): Promise<{ success: boolean }> {
        return { success: true };
      }
    }

    const sheet = new Sheet(new HistoryStore());
    await sheet.setData({ r: 5, c: 1 }, '10');

    sheet.selectStart({ r: 5, c: 1 });
    await sheet.copy();
    expect(sheet.getCopyRange()).toEqual([
      { r: 5, c: 1 },
      { r: 5, c: 1 },
    ]);

    // An undone step may be a row insert, delete or reorder, which renumbers
    // the cells the buffer snapshotted; pasting from it afterwards would
    // relocate — and re-create merged blocks — from stale coordinates.
    await sheet.undo();
    expect(sheet.getCopyRange()).toBeUndefined();

    sheet.selectStart({ r: 5, c: 1 });
    await sheet.copy();
    await sheet.redo();
    expect(sheet.getCopyRange()).toBeUndefined();
  });

  it('should drop the copy buffer when a peer renumbers the copied rows', async () => {
    // MemStore has no axis IDs, so stand one up: `revalidateCopyBuffer` reads
    // the order arrays a remote structural edit rewrites.
    class AxisIdStore extends MemStore {
      public rowIds = ['r1', 'r2', 'r3', 'r4', 'r5'];
      public colIds = ['c1', 'c2', 'c3'];
      override getRowOrder(): string[] {
        return this.rowIds;
      }
      override getColOrder(): string[] {
        return this.colIds;
      }
    }

    const store = new AxisIdStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 2, c: 1 }, '10');

    sheet.selectStart({ r: 2, c: 1 });
    await sheet.copy();

    // A peer edits a cell: nothing is renumbered, so the clipboard survives.
    sheet.revalidateCopyBuffer();
    expect(sheet.getCopyRange()).toEqual([
      { r: 2, c: 1 },
      { r: 2, c: 1 },
    ]);

    // A peer inserts a row above: 'r2' is now row 3, so the index-keyed buffer
    // no longer describes what it copied.
    store.rowIds = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];
    sheet.revalidateCopyBuffer();
    expect(sheet.getCopyRange()).toBeUndefined();
  });
});
