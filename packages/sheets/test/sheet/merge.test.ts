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
