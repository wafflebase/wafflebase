import { describe, expect, it } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';

describe('Sheet.setData input inference', () => {
  it('normalizes currency value and stores inferred currency format', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '₩ 113,300,000');

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell).toEqual({
      v: '113300000',
      s: { nf: 'currency', cu: 'KRW' },
    });

    const displayed = await sheet.toDisplayString({ r: 1, c: 1 });
    expect(displayed).toContain('113,300,000');
    expect(displayed).not.toContain('.');
  });

  it('normalizes percent value and stores percent format', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12.34%');

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell).toEqual({
      v: '0.1234',
      s: { nf: 'percent' },
    });
  });

  it('stores booleans as normalized logical values', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'true');

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell).toEqual({ v: 'TRUE' });
  });

  it('stores trimmed formula expressions while preserving "=" prefix in cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '= SUM(1,2)');

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell?.f).toBe('=SUM(1,2)');
    expect(await sheet.toInputString({ r: 1, c: 1 })).toBe('=SUM(1,2)');
  });

  it('auto-completes missing closing parenthesis for formulas on commit', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '=sum(1,2,3');

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell?.f).toBe('=sum(1,2,3)');
    expect(cell?.v).toBe('6');
    expect(await sheet.toInputString({ r: 1, c: 1 })).toBe('=sum(1,2,3)');
  });

  it('keeps leading-zero identifiers as text', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '00123');

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell).toEqual({ v: '00123' });
  });
});
