import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';

/**
 * Cmd/Ctrl+D and Cmd/Ctrl+R (Google Sheets "fill down" / "fill right").
 * Unlike the fill handle these never extrapolate a series: the source row
 * (or column) is copied verbatim, formulas relocated by the offset.
 */
describe('Sheet.fill', () => {
  it('copies the top row of the selection down through it', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, 'x');
    await sheet.setData({ r: 2, c: 1 }, '2');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    expect(await sheet.fill('down')).toBe(true);

    // Copied, not extrapolated: 1, 1, 1 — and the stale "2" is overwritten.
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('x');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('x');
    // The selection is left where it was.
    expect(sheet.getRange()).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 2 },
    ]);
  });

  it('copies the cell above into a single selected cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 2 }, 'above');

    sheet.selectStart({ r: 2, c: 2 });
    expect(await sheet.fill('down')).toBe(true);
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('above');
  });

  it('does nothing for a single cell on the first row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'a');

    sheet.selectStart({ r: 1, c: 1 });
    expect(await sheet.fill('down')).toBe(false);
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('a');
  });

  it('relocates formulas by the row offset', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '3');
    await sheet.setData({ r: 2, c: 1 }, '4');
    await sheet.setData({ r: 1, c: 2 }, '=A1*2');

    sheet.selectStart({ r: 1, c: 2 });
    sheet.selectEnd({ r: 2, c: 2 });
    expect(await sheet.fill('down')).toBe(true);

    expect(await sheet.toInputString({ r: 2, c: 2 })).toBe('=A2*2');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('8');
  });

  it('fills right from the left column', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'L');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    expect(await sheet.fill('right')).toBe(true);

    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('L');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('L');
  });

  it('clears targets whose source cell is empty', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 1 }, 'stale');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 1 });
    expect(await sheet.fill('down')).toBe(true);
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
  });

  // `MemStore` keeps no history, so "one undo step" is asserted the way the
  // collaborative store groups it: every write lands inside one batch.
  it('writes every cell inside a single batch (one undo step)', async () => {
    const store = new BatchTrackingStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, 'a');
    await sheet.setData({ r: 1, c: 2 }, 'b');
    store.writes = [];
    store.batches = 0;

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 2 });
    expect(await sheet.fill('down')).toBe(true);

    expect(store.batches).toBe(1);
    expect(store.writes.length).toBeGreaterThanOrEqual(6);
    expect(store.writes.every((depth) => depth === 1)).toBe(true);
  });
});

class BatchTrackingStore extends MemStore {
  depth = 0;
  batches = 0;
  writes: number[] = [];

  beginBatch(): void {
    if (this.depth === 0) this.batches++;
    this.depth++;
  }

  endBatch(): void {
    this.depth--;
  }

  async set(...args: Parameters<MemStore['set']>) {
    this.writes.push(this.depth);
    return super.set(...args);
  }

  async delete(...args: Parameters<MemStore['delete']>) {
    this.writes.push(this.depth);
    return super.delete(...args);
  }
}
