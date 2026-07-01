import { describe, expect, it } from 'vitest';
import { materialize } from '../../src/model/pivot/materialize';
import type { PivotResult } from '../../src/model/core/types';
import { toSref } from '../../src/model/core/coordinates';

describe('materialize', () => {
  it('converts PivotResult into Grid of cells starting at A1', () => {
    const result: PivotResult = {
      cells: [
        [
          { value: '', type: 'empty' },
          { value: 'Q1', type: 'colHeader' },
          { value: 'Q2', type: 'colHeader' },
        ],
        [
          { value: 'Eng', type: 'rowHeader' },
          { value: '250', type: 'value' },
          { value: '250', type: 'value' },
        ],
      ],
      rowCount: 2,
      colCount: 3,
    };
    const grid = materialize(result);
    expect(grid.get(toSref({ r: 1, c: 1 }))).toEqual({
      v: '',
      s: { b: true },
    });
    expect(grid.get(toSref({ r: 1, c: 2 }))).toEqual({
      v: 'Q1',
      s: { b: true },
    });
    expect(grid.get(toSref({ r: 2, c: 1 }))).toEqual({
      v: 'Eng',
      s: { b: true },
    });
    expect(grid.get(toSref({ r: 2, c: 2 }))).toEqual({ v: '250' });
  });

  it('applies total styling to total cells', () => {
    const result: PivotResult = {
      cells: [
        [
          { value: 'Grand Total', type: 'total' },
          { value: '500', type: 'total' },
        ],
      ],
      rowCount: 1,
      colCount: 2,
    };
    const grid = materialize(result);
    const cell = grid.get(toSref({ r: 1, c: 1 }));
    expect(cell?.s).toEqual({ b: true });
  });

  it('merges inherited format into header and value cell styles', () => {
    const result: PivotResult = {
      cells: [
        [
          { value: '2026-07-01', type: 'rowHeader', format: { nf: 'date' } },
          {
            value: '100',
            type: 'value',
            format: { nf: 'currency', cu: 'USD' },
          },
        ],
      ],
      rowCount: 1,
      colCount: 2,
    };
    const grid = materialize(result);
    // Header keeps bold and gains the date format.
    expect(grid.get(toSref({ r: 1, c: 1 }))).toEqual({
      v: '2026-07-01',
      s: { b: true, nf: 'date' },
    });
    // Value cell (no bold) gains the currency format.
    expect(grid.get(toSref({ r: 1, c: 2 }))).toEqual({
      v: '100',
      s: { nf: 'currency', cu: 'USD' },
    });
  });

  it('skips value cells with empty value', () => {
    const result: PivotResult = {
      cells: [
        [
          { value: 'A', type: 'rowHeader' },
          { value: '', type: 'value' },
        ],
      ],
      rowCount: 1,
      colCount: 2,
    };
    const grid = materialize(result);
    expect(grid.has(toSref({ r: 1, c: 2 }))).toBe(false);
  });
});
