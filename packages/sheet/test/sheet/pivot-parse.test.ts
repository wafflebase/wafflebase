import { describe, expect, it } from 'vitest';
import { parseSourceData } from '../../src/model/pivot/parse';
import type { Grid, Range } from '../../src/model/types';
import { toSref } from '../../src/model/coordinates';

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
});
