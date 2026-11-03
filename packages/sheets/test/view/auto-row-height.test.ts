import { describe, expect, it } from 'vitest';
import {
  autoRowHeight,
  computeAutoRowHeights,
} from '../../src/view/auto-row-height';
import { DefaultCellHeight } from '../../src/view/layout';
import type { Grid } from '../../src/model/core/types';

describe('autoRowHeight', () => {
  it('leaves single-line content at the default height', () => {
    expect(autoRowHeight(0)).toBe(DefaultCellHeight);
    expect(autoRowHeight(1)).toBe(DefaultCellHeight);
  });

  it('grows with the line count', () => {
    const two = autoRowHeight(2);
    const three = autoRowHeight(3);
    expect(two).toBeGreaterThan(DefaultCellHeight);
    expect(three).toBeGreaterThan(two);
  });
});

describe('computeAutoRowHeights', () => {
  it('reports nothing for single-line rows', () => {
    const grid: Grid = new Map([
      ['A1', { v: 'first' }],
      ['B1', { v: 'second' }],
    ]);

    expect(computeAutoRowHeights(grid).size).toBe(0);
  });

  it('sizes a row to its multi-line value, whoever wrote it', () => {
    const grid: Grid = new Map([['A1', { v: 'first\nsecond' }]]);

    expect(computeAutoRowHeights(grid)).toEqual(
      new Map([[1, autoRowHeight(2)]]),
    );
  });

  it('takes the tallest cell in the row', () => {
    const grid: Grid = new Map([
      ['A2', { v: 'one\ntwo' }],
      ['C2', { v: 'one\ntwo\nthree' }],
      ['D2', { v: 'flat' }],
    ]);

    expect(computeAutoRowHeights(grid)).toEqual(
      new Map([[2, autoRowHeight(3)]]),
    );
  });

  it('ignores formulas and empty values', () => {
    const grid: Grid = new Map([
      ['A1', { f: '=A2\n+1' }],
      ['A2', { v: '' }],
    ]);

    expect(computeAutoRowHeights(grid).size).toBe(0);
  });

  it('skips rows the caller excludes', () => {
    const grid: Grid = new Map([
      ['A1', { v: 'first\nsecond' }],
      ['A3', { v: 'first\nsecond' }],
    ]);

    expect(computeAutoRowHeights(grid, new Set([1]))).toEqual(
      new Map([[3, autoRowHeight(2)]]),
    );
  });
});
