import { parseRef, toSref } from './coordinates';
import { Cell, Grid, Ref, Sref } from './types';

/**
 * `grid2string` converts the given grid to a string representation.
 */
export function grid2string(grid: Grid): string {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = 0;
  let maxCol = 0;

  for (const [sref] of grid.entries()) {
    const { r: row, c: col } = parseRef(sref);
    minRow = Math.min(minRow, row);
    minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }

  const table: Array<Array<string>> = Array.from(
    { length: maxRow - minRow + 1 },
    () => Array(maxCol - minCol + 1).fill(''),
  );

  for (const [sref, value] of grid.entries()) {
    const { r: row, c: col } = parseRef(sref);
    table[row - minRow][col - minCol] = value.v || value.f || '';
  }

  return table.map((row) => row.join('\t')).join('\n');
}

/**
 * `string2grid` converts the given string to a grid representation.
 */
export function string2grid(ref: Ref, value: string): Grid {
  let row = ref.r;
  let col = ref.c;

  const grid = new Map<Sref, Cell>();
  const lines = value.split('\n');
  for (const line of lines) {
    const cells = line.split('\t');
    for (const cell of cells) {
      grid.set(toSref({ r: row, c: col }), { v: cell });
      col += 1;
    }

    row += 1;
    col = ref.c;
  }

  return grid;
}
