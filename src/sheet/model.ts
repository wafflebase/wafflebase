import { parseRef } from './coordinates';
import { Grid, Range } from './types';

/**
 * `toRange` function returns the range of the given grid.
 */
export function toRange(chunk: Grid): Range {
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;

  for (const sref of chunk.keys()) {
    const { r, c } = parseRef(sref);
    minRow = Math.min(minRow, r);
    maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, c);
    maxCol = Math.max(maxCol, c);
  }

  return [
    { r: minRow, c: minCol },
    { r: maxRow, c: maxCol },
  ];
}
