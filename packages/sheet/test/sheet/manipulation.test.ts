import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';

describe('Sheet.insertRows', () => {
  it('should insert multiple rows at once', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');

    await sheet.insertRows(2, 3);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 6, c: 1 })).toBe('30');
  });

  it('should shift data down when inserting a row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');

    await sheet.insertRows(2);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('30');
  });

  it('should update formula references after insert', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '=A1+A2');

    await sheet.insertRows(2);

    // A3 was =A1+A2, now shifted to A4 with formula =A1+A3
    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=A1+A3');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('30');
  });
});

describe('Sheet.deleteRows', () => {
  it('should delete multiple rows at once', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');
    await sheet.setData({ r: 4, c: 1 }, '40');
    await sheet.setData({ r: 5, c: 1 }, '50');

    await sheet.deleteRows(2, 3);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('50');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
  });

  it('should shift data up when deleting a row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');

    await sheet.deleteRows(2);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('');
  });

  it('should produce #REF! for formulas referencing deleted row', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '=A1+A2');

    await sheet.deleteRows(2);

    // A3 was =A1+A2, A2 was deleted → formula becomes =A1+#REF!
    expect(await sheet.toInputString({ r: 2, c: 1 })).toBe('=A1+#REF!');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('#ERROR!');
  });
});

describe('Sheet.insertColumns', () => {
  it('should insert multiple columns at once', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');

    await sheet.insertColumns(2, 3);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 5 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 1, c: 6 })).toBe('30');
  });

  it('should shift data right when inserting a column', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');

    await sheet.insertColumns(2);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('30');
  });

  it('should update formula references after column insert', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '=A1+B1');

    await sheet.insertColumns(2);

    // C1 was =A1+B1, now shifted to D1 with formula =A1+C1
    expect(await sheet.toInputString({ r: 1, c: 4 })).toBe('=A1+C1');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('30');
  });
});

describe('Sheet.deleteColumns', () => {
  it('should delete multiple columns at once', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');
    await sheet.setData({ r: 1, c: 4 }, '40');
    await sheet.setData({ r: 1, c: 5 }, '50');

    await sheet.deleteColumns(2, 3);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('50');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('');
  });

  it('should shift data left when deleting a column', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');

    await sheet.deleteColumns(2);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('');
  });

  it('should produce #REF! for formulas referencing deleted column', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '=A1+B1');

    await sheet.deleteColumns(2);

    // C1 was =A1+B1, B1 was deleted → formula becomes =A1+#REF!
    expect(await sheet.toInputString({ r: 1, c: 2 })).toBe('=A1+#REF!');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('#ERROR!');
  });
});
