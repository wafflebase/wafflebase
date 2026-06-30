import { describe, expect, it } from 'vitest';
import { parseSourceData } from '../../src/model/pivot/parse';
import type { Cell, Grid, Range } from '../../src/model/core/types';
import { toSref } from '../../src/model/core/coordinates';

function buildGrid(data: string[][]): Grid {
  const grid: Grid = new Map();
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (data[r][c] !== '') {
        grid.set(toSref({ r: r + 1, c: c + 1 }), { v: data[r][c] });
      }
    }
  }
  return grid;
}

describe('parseSourceData', () => {
  it('extracts headers from first row and records from remaining rows', () => {
    const grid = buildGrid([
      ['Name', 'Dept', 'Salary'],
      ['Alice', 'Eng', '100'],
      ['Bob', 'Sales', '200'],
    ]);
    const range: Range = [{ r: 1, c: 1 }, { r: 3, c: 3 }];
    const { headers, records } = parseSourceData(grid, range);
    expect(headers).toEqual(['Name', 'Dept', 'Salary']);
    expect(records).toEqual([['Alice', 'Eng', '100'], ['Bob', 'Sales', '200']]);
  });

  it('treats empty cells as empty strings', () => {
    const grid = buildGrid([['A', 'B'], ['1', '']]);
    const range: Range = [{ r: 1, c: 1 }, { r: 2, c: 2 }];
    const { records } = parseSourceData(grid, range);
    expect(records).toEqual([['1', '']]);
  });

  it('trims trailing empty rows', () => {
    const grid = buildGrid([['A', 'B'], ['1', '2'], ['', ''], ['', '']]);
    const range: Range = [{ r: 1, c: 1 }, { r: 4, c: 2 }];
    const { records } = parseSourceData(grid, range);
    expect(records).toEqual([['1', '2']]);
  });

  it('returns empty records when only headers exist', () => {
    const grid = buildGrid([['A', 'B']]);
    const range: Range = [{ r: 1, c: 1 }, { r: 1, c: 2 }];
    const { headers, records } = parseSourceData(grid, range);
    expect(headers).toEqual(['A', 'B']);
    expect(records).toEqual([]);
  });

  it('extracts per-column number formats from data cells', () => {
    const grid: Grid = new Map();
    const set = (r: number, c: number, cell: Cell) =>
      grid.set(toSref({ r, c }), cell);
    // Headers (no format).
    set(1, 1, { v: 'Date' });
    set(1, 2, { v: 'Amount' });
    set(1, 3, { v: 'Name' });
    // Data: date column, currency column, plain text column.
    set(2, 1, { v: '2026-07-01', s: { nf: 'date' } });
    set(2, 2, { v: '100', s: { nf: 'currency', cu: 'USD', dp: 2 } });
    set(2, 3, { v: 'Alice' });
    const range: Range = [{ r: 1, c: 1 }, { r: 2, c: 3 }];
    const { columnFormats } = parseSourceData(grid, range);
    expect(columnFormats[0]).toEqual({ nf: 'date' });
    expect(columnFormats[1]).toEqual({ nf: 'currency', cu: 'USD', dp: 2 });
    expect(columnFormats[2]).toBeUndefined();
  });

  it('uses the first data cell that carries a format per column', () => {
    const grid: Grid = new Map();
    grid.set(toSref({ r: 1, c: 1 }), { v: 'Date' });
    // First data cell has no format; second one does.
    grid.set(toSref({ r: 2, c: 1 }), { v: '2026-07-01' });
    grid.set(toSref({ r: 3, c: 1 }), { v: '2026-07-02', s: { nf: 'date' } });
    const range: Range = [{ r: 1, c: 1 }, { r: 3, c: 1 }];
    const { columnFormats } = parseSourceData(grid, range);
    expect(columnFormats[0]).toEqual({ nf: 'date' });
  });
});
