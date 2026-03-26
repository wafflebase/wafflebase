import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';
import { computeLinearTrend } from '../../src/model/worksheet/clipboard';

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

  it('extrapolates a multi-cell numeric pattern via OLS (vertical)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 2, c: 1 }, '3');
    await sheet.setData({ r: 2, c: 2 }, '4');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    const changed = await sheet.autofill({ r: 4, c: 2 });

    expect(changed).toBe(true);
    // OLS: col1 y=2x-1 → r3=5, r4=7; col2 y=2x → r3=6, r4=8
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('5');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('6');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('8');
  });

  it('constrains autofill to single axis (vertical wins on tie)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'a');

    sheet.selectStart({ r: 1, c: 1 });
    // Diagonal target: row extends by 2, col extends by 1 → vertical wins
    const changed = await sheet.autofill({ r: 3, c: 2 });

    expect(changed).toBe(true);
    // Vertical fill only: cols stay at 1
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('a');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('a');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('');
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

  it('extrapolates linear trend horizontally via OLS', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 3 });
    const changed = await sheet.autofill({ r: 1, c: 6 });

    expect(changed).toBe(true);
    // OLS: y = 10x → c4=40, c5=50, c6=60
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('40');
    expect(await sheet.toDisplayString({ r: 1, c: 5 })).toBe('50');
    expect(await sheet.toDisplayString({ r: 1, c: 6 })).toBe('60');
  });

  it('extrapolates non-linear numeric data with OLS best-fit', async () => {
    const sheet = new Sheet(new MemStore());
    // Irregular data: 2, 5, 4 → OLS regression
    await sheet.setData({ r: 1, c: 1 }, '2');
    await sheet.setData({ r: 2, c: 1 }, '5');
    await sheet.setData({ r: 3, c: 1 }, '4');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    const changed = await sheet.autofill({ r: 5, c: 1 });

    expect(changed).toBe(true);
    // OLS: x=[1,2,3] y=[2,5,4] → m=1, b=5/3
    // r4: 1*4 + 5/3 ≈ 5.667, r5: 1*5 + 5/3 ≈ 6.667
    const r4 = Number(await sheet.toDisplayString({ r: 4, c: 1 }));
    const r5 = Number(await sheet.toDisplayString({ r: 5, c: 1 }));
    expect(r4).toBeCloseTo(5.667, 2);
    expect(r5).toBeCloseTo(6.667, 2);
  });

  it('falls back to tiling for mixed numeric and text cells', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, 'hello');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 1 });
    const changed = await sheet.autofill({ r: 4, c: 1 });

    expect(changed).toBe(true);
    // Tiling fallback: pattern repeats
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('hello');
  });

  it('falls back to tiling for formula cells even with numeric values', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '=1+1');
    await sheet.setData({ r: 2, c: 1 }, '=2+2');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 1 });
    const changed = await sheet.autofill({ r: 4, c: 1 });

    expect(changed).toBe(true);
    // Formula cells use tiling with relocation, not OLS
    expect(await sheet.toInputString({ r: 3, c: 1 })).toBe('=1+1');
    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=2+2');
  });

  it('preserves 15-digit precision for repeating decimals', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '3');
    await sheet.setData({ r: 3, c: 1 }, '7');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    const changed = await sheet.autofill({ r: 4, c: 1 });

    expect(changed).toBe(true);
    // 29/3 → must display 9.66666666666667, not 9.66666666666666
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('9.66666666666667');
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

describe('computeLinearTrend', () => {
  it('returns undefined for fewer than 2 points', () => {
    expect(computeLinearTrend([1], [5], 2)).toBeUndefined();
    expect(computeLinearTrend([], [], 1)).toBeUndefined();
  });

  it('computes exact trend for perfect linear data', () => {
    // y = 2x + 1: (1,3), (2,5), (3,7)
    expect(computeLinearTrend([1, 2, 3], [3, 5, 7], 4)).toBe(9);
    expect(computeLinearTrend([1, 2, 3], [3, 5, 7], 5)).toBe(11);
  });

  it('computes OLS best-fit for noisy data', () => {
    // x=[1,2,3] y=[2,5,4] → m=1, b≈1.667
    const result = computeLinearTrend([1, 2, 3], [2, 5, 4], 4);
    expect(result).toBeCloseTo(5.667, 2);
  });

  it('handles constant y values (slope = 0)', () => {
    expect(computeLinearTrend([1, 2, 3], [5, 5, 5], 10)).toBe(5);
  });

  it('handles negative slope', () => {
    // y = -3x + 13: (1,10), (2,7), (3,4)
    expect(computeLinearTrend([1, 2, 3], [10, 7, 4], 4)).toBe(1);
  });

  it('preserves precision for repeating decimals (single-fraction)', () => {
    // 1, 3, 7 → A=18, D=6, y(4) = (3*18*4 + 11*6 - 18*6)/(3*6) = 174/18 = 29/3
    // Must produce 9.66666666666667 (15 sig digits), not 9.66666666666666
    const result = computeLinearTrend([1, 2, 3], [1, 3, 7], 4)!;
    expect(result.toPrecision(15)).toBe('9.66666666666667');
  });

  it('preserves precision for negative slope repeating decimals', () => {
    // 10, 5, 2 → y(4) = -7/3, toPrecision(15) ends in ...33 (no rounding up)
    const result = computeLinearTrend([1, 2, 3], [10, 5, 2], 4)!;
    expect(result.toPrecision(15)).toBe('-2.33333333333333');
    // Verify single-fraction computation matches direct -7/3
    expect(result).toBe(-7 / 3);
  });
});
