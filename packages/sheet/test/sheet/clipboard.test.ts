import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';

describe('Sheet.copy', () => {
  it('should return TSV text of selected range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 2, c: 1 }, '30');
    await sheet.setData({ r: 2, c: 2 }, '40');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    const { text } = await sheet.copy();
    expect(text).toBe('10\t20\n30\t40');
  });

  it('should copy single cell when no range is selected', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '42');
    sheet.selectStart({ r: 1, c: 1 });

    const { text } = await sheet.copy();
    expect(text).toBe('42');
  });
});

describe('Sheet.paste - internal formula relocation', () => {
  it('should relocate formula references when pasting internally', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 2, c: 1 }, '=A1+B1');

    // Verify formula computed correctly
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');

    // Select A2 (the formula cell) and copy
    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.copy();

    // Move to A4 and paste
    sheet.selectStart({ r: 4, c: 1 });
    await sheet.paste({ text });

    // Formula should be relocated: =A1+B1 → =A3+B3
    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=A3+B3');
  });

  it('should relocate formula with column shift', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 2, c: 1 }, '=A1+10');

    // Copy A2
    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.copy();

    // Paste to B3
    sheet.selectStart({ r: 3, c: 2 });
    await sheet.paste({ text });

    // Formula relocated: =A1+10 → =B2+10
    expect(await sheet.toInputString({ r: 3, c: 2 })).toBe('=B2+10');
  });

  it('should preserve plain cell values on internal paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'hello');
    await sheet.setData({ r: 1, c: 2 }, 'world');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('hello');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('world');
  });

  it('should preserve cell styles on internal paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ b: true, bg: '#ff0000' });

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });

    const cell = await sheet.getCell({ r: 2, c: 1 });
    expect(cell?.s?.b).toBe(true);
    expect(cell?.s?.bg).toBe('#ff0000');
  });
});

describe('Sheet.paste - external TSV', () => {
  it('should paste TSV text as plain values', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.paste({ text: '10\t20\n30\t40' });

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('40');
  });

  it('should treat modified clipboard text as external paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.copy();

    // Paste with different text (user edited clipboard)
    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text: 'modified' });

    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('modified');
  });
});

describe('Sheet.paste - formula recalculation', () => {
  it('should recalculate formulas after paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 1, c: 2 }, '10');
    await sheet.setData({ r: 3, c: 1 }, '100');
    await sheet.setData({ r: 3, c: 2 }, '200');
    await sheet.setData({ r: 2, c: 1 }, '=A1+B1');

    // Copy A2 (formula =A1+B1, value 15)
    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.copy();

    // Paste to A4 — formula becomes =A3+B3 which references 100+200
    sheet.selectStart({ r: 4, c: 1 });
    await sheet.paste({ text });

    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=A3+B3');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('300');
  });

  it('should recalculate dependant formula chain when pasting plain values', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '=A1*2');
    await sheet.setData({ r: 1, c: 3 }, '=B1*2');

    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('2');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('4');

    // Paste plain value into A1 (not a formula cell)
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.paste({ text: '5' });

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('5');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('20');
  });
});
