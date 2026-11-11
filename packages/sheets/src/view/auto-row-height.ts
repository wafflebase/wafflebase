import { parseRef } from '../model/core/coordinates';
import type { Grid } from '../model/core/types';
import { CellPaddingY, DefaultCellHeight, getTextBlockHeight } from './layout';

/**
 * `autoRowHeight` returns the height a row needs to show `lineCount` lines.
 *
 * Only explicit newlines are counted by the callers, matching what the
 * painter draws: it splits `cell.v` on `\n` and never soft-wraps.
 */
export function autoRowHeight(lineCount: number): number {
  if (lineCount <= 1) {
    return DefaultCellHeight;
  }

  return Math.max(
    DefaultCellHeight,
    Math.ceil(getTextBlockHeight(lineCount) + 2 * CellPaddingY),
  );
}

/**
 * `computeAutoRowHeights` returns the content height of every row in `grid`
 * that needs more than the default, keyed by 1-based row index.
 *
 * This is the "fit to data" rule rows follow when they carry no explicit
 * height: a row is as tall as its tallest cell, whichever writer put the
 * value there. Rows in `skipRows` are excluded — the caller passes the rows
 * whose height is somebody else's decision (a manually sized row, or the
 * anchor of a merge that spans several rows, where the text is laid out
 * against the block rather than the row).
 */
export function computeAutoRowHeights(
  grid: Grid,
  skipRows?: ReadonlySet<number>,
): Map<number, number> {
  const lines = new Map<number, number>();

  for (const [sref, cell] of grid) {
    if (!cell.v || !cell.v.includes('\n')) {
      continue;
    }
    const { r } = parseRef(sref);
    if (skipRows?.has(r)) {
      continue;
    }
    const count = cell.v.split('\n').length;
    if (count > (lines.get(r) ?? 1)) {
      lines.set(r, count);
    }
  }

  const heights = new Map<number, number>();
  for (const [row, count] of lines) {
    const height = autoRowHeight(count);
    if (height !== DefaultCellHeight) {
      heights.set(row, height);
    }
  }
  return heights;
}

/**
 * `axisTranslator` maps a 1-based index in the axis order `from` (axis IDs,
 * first index first) to the index the same axis ID has in `to`, or to
 * `undefined` when that ID is gone or the index had none.
 *
 * With either order empty there are no IDs to go by, and every index maps to
 * itself. The lookup table is only built once an index has actually moved.
 */
export function axisTranslator(
  from: ReadonlyArray<string>,
  to: ReadonlyArray<string>,
): (index: number) => number | undefined {
  if (from === to || from.length === 0 || to.length === 0) {
    return (index) => index;
  }
  let positions: Map<string, number> | undefined;
  return (index) => {
    const id = from[index - 1];
    if (id === undefined) {
      return undefined;
    }
    if (to[index - 1] === id) {
      return index;
    }
    if (!positions) {
      positions = new Map();
      for (let i = 0; i < to.length; i++) {
        positions.set(to[i], i + 1);
      }
    }
    return positions.get(id);
  };
}
