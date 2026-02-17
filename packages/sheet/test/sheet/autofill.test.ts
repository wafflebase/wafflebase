import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/sheet';
import { MemStore } from '../../src/store/memory';

describe('Sheet.autofill', () => {
  it('fills a single value down', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '7');

    sheet.selectStart({ r: 1, c: 1 });
    const changed = await sheet.autofill({ r: 4, c: 1 });

    expect(changed).toBe(true);
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('7');
    expect(sheet.getRange()).toEqual([
      { r: 1, c: 1 },
      { r: 4, c: 1 },
    ]);
  });

  it('tiles a multi-cell pattern across a larger range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 2, c: 1 }, '3');
    await sheet.setData({ r: 2, c: 2 }, '4');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    const changed = await sheet.autofill({ r: 4, c: 3 });

    expect(changed).toBe(true);
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('4');
    expect(await sheet.toDisplayString({ r: 4, c: 3 })).toBe('3');
  });

  it('relocates formulas during autofill', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '2');
    await sheet.setData({ r: 3, c: 1 }, '3');
    await sheet.setData({ r: 4, c: 1 }, '4');
    await sheet.setData({ r: 1, c: 2 }, '=A1*10');
    await sheet.setData({ r: 2, c: 2 }, '=A2*10');

    sheet.selectStart({ r: 1, c: 2 });
    sheet.selectEnd({ r: 2, c: 2 });
    const changed = await sheet.autofill({ r: 4, c: 2 });

    expect(changed).toBe(true);
    expect(await sheet.toInputString({ r: 3, c: 2 })).toBe('=A3*10');
    expect(await sheet.toInputString({ r: 4, c: 2 })).toBe('=A4*10');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('40');
  });

  it('clears destination cells when mapped source cell is empty', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'x');
    await sheet.setData({ r: 2, c: 2 }, 'old');
    await sheet.setData({ r: 3, c: 2 }, 'old2');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const changed = await sheet.autofill({ r: 3, c: 2 });

    expect(changed).toBe(true);
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('x');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('x');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('');
  });

  it('returns false when target is already inside the source range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '2');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 1 });
    const changed = await sheet.autofill({ r: 2, c: 1 });

    expect(changed).toBe(false);
    expect(sheet.getRange()).toEqual([
      { r: 1, c: 1 },
      { r: 2, c: 1 },
    ]);
  });

  it('blocks autofill when merged cells are inside the fill range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'merged');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.toggleMergeSelection();

    sheet.selectStart({ r: 1, c: 1 });
    const changed = await sheet.autofill({ r: 2, c: 1 });

    expect(changed).toBe(false);
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
  });
});
