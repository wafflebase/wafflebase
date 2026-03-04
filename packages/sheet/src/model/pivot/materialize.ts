import { toSref } from '../coordinates';
import type { Cell, Grid, PivotResult } from '../types';

/**
 * `materialize` converts a PivotResult into a Grid (Map<Sref, Cell>).
 *
 * - rowHeader / colHeader / empty cells get bold styling.
 * - total cells get bold + gray background styling.
 * - value cells are plain (no styling); empty value cells are skipped.
 *
 * Grid positions are 1-based: cells[r][c] maps to {r: r+1, c: c+1}.
 */
export function materialize(result: PivotResult): Grid {
  const grid: Grid = new Map();

  for (let r = 0; r < result.cells.length; r++) {
    const row = result.cells[r];
    for (let c = 0; c < row.length; c++) {
      const pivotCell = row[c];
      const sref = toSref({ r: r + 1, c: c + 1 });

      let cell: Cell | undefined;
      switch (pivotCell.type) {
        case 'rowHeader':
        case 'colHeader':
        case 'empty':
          cell = { v: pivotCell.value, s: { b: true } };
          break;
        case 'total':
          cell = { v: pivotCell.value, s: { b: true, bg: '#f3f4f6' } };
          break;
        case 'value':
          if (pivotCell.value !== '') {
            cell = { v: pivotCell.value };
          }
          break;
      }

      if (cell !== undefined) {
        grid.set(sref, cell);
      }
    }
  }

  return grid;
}
