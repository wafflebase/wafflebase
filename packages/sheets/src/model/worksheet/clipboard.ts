import { Cell, Grid, Ref, Range, Sref } from '../core/types';
import { parseRef, toSref, inRange, mergeRanges } from '../core/coordinates';
import { relocateFormula } from './shifting';

/**
 * `relocateGrid` clones a grid with formula references adjusted by the
 * position delta between sourceRange and destRef. For formula cells,
 * recalculated values are cleared (they'll be recalculated after paste).
 */
export function relocateGrid(
  grid: Grid,
  sourceRange: Range,
  destRef: Ref,
): Grid {
  const deltaRow = destRef.r - sourceRange[0].r;
  const deltaCol = destRef.c - sourceRange[0].c;
  const newGrid: Grid = new Map();

  for (const [sref, cell] of grid) {
    const ref = parseRef(sref);
    const newRef = { r: ref.r + deltaRow, c: ref.c + deltaCol };
    const newSref = toSref(newRef);

    if (cell.f) {
      const newFormula = relocateFormula(cell.f, deltaRow, deltaCol);
      newGrid.set(newSref, { f: newFormula, s: cell.s });
    } else {
      newGrid.set(newSref, { ...cell });
    }
  }

  return newGrid;
}

/**
 * `buildCutRefMap` builds a mapping from source srefs to destination srefs
 * for redirecting formula references after a cut-paste operation.
 */
export function buildCutRefMap(
  sourceRange: Range,
  deltaRow: number,
  deltaCol: number,
): Map<Sref, Sref> {
  const refMap = new Map<Sref, Sref>();
  for (let r = sourceRange[0].r; r <= sourceRange[1].r; r++) {
    for (let c = sourceRange[0].c; c <= sourceRange[1].c; c++) {
      const oldSref = toSref({ r, c });
      const newSref = toSref({ r: r + deltaRow, c: c + deltaCol });
      refMap.set(oldSref, newSref);
    }
  }
  return refMap;
}

/**
 * `computeAutofillRange` returns the expanded fill range constrained to a
 * single axis (vertical or horizontal), or undefined when `target` is inside
 * the source range.  The dominant axis is the one where the target is
 * furthest from the source edge; ties favour vertical.
 */
export function computeAutofillRange(
  sourceRange: Range,
  target: Ref,
): Range | undefined {
  if (inRange(target, sourceRange)) {
    return undefined;
  }

  const distUp = Math.max(0, sourceRange[0].r - target.r);
  const distDown = Math.max(0, target.r - sourceRange[1].r);
  const distLeft = Math.max(0, sourceRange[0].c - target.c);
  const distRight = Math.max(0, target.c - sourceRange[1].c);

  const verticalDist = Math.max(distUp, distDown);
  const horizontalDist = Math.max(distLeft, distRight);

  if (verticalDist >= horizontalDist) {
    // Constrain to vertical: keep source columns, extend rows to target
    const clampedTarget: Ref = { r: target.r, c: sourceRange[1].c };
    return mergeRanges(sourceRange, [clampedTarget, clampedTarget]);
  } else {
    // Constrain to horizontal: keep source rows, extend columns to target
    const clampedTarget: Ref = { r: sourceRange[1].r, c: target.c };
    return mergeRanges(sourceRange, [clampedTarget, clampedTarget]);
  }
}

/**
 * `positiveMod` returns a positive modulo result for wrap-around indexing.
 */
export function positiveMod(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

/**
 * `cloneCellForAutofill` clones a source cell for a destination position.
 * Formula cells are relocated and their cached values are dropped.
 */
export function cloneCellForAutofill(
  sourceCell: Cell,
  deltaRow: number,
  deltaCol: number,
): Cell {
  if (sourceCell.f) {
    const formula = relocateFormula(sourceCell.f, deltaRow, deltaCol);
    return sourceCell.s
      ? { f: formula, s: { ...sourceCell.s } }
      : { f: formula };
  }

  const next: Cell = {};
  if (sourceCell.v !== undefined) {
    next.v = sourceCell.v;
  }
  if (sourceCell.s) {
    next.s = { ...sourceCell.s };
  }
  return next;
}
