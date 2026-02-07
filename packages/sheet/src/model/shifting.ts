import { extractTokens } from '../formula/formula';
import { parseRef, toSref } from './coordinates';
import { Axis, Cell, Grid, Ref, Sref } from './types';

/**
 * `shiftRef` shifts a Ref along the given axis.
 * Returns `null` if the ref falls in a deleted zone.
 *
 * - Insert (count > 0): refs at >= index shift by +count
 * - Delete (count < 0): refs in [index, index+|count|) → null;
 *   refs at >= index+|count| shift by count
 */
export function shiftRef(
  ref: Ref,
  axis: Axis,
  index: number,
  count: number,
): Ref | null {
  const value = axis === 'row' ? ref.r : ref.c;

  if (count > 0) {
    // Insert: shift refs at or after index
    if (value >= index) {
      return axis === 'row'
        ? { r: ref.r + count, c: ref.c }
        : { r: ref.r, c: ref.c + count };
    }
    return ref;
  }

  // Delete: count < 0
  const absCount = Math.abs(count);
  if (value >= index && value < index + absCount) {
    // Ref is in the deleted zone
    return null;
  }
  if (value >= index + absCount) {
    // Ref is after the deleted zone, shift up/left
    return axis === 'row'
      ? { r: ref.r + count, c: ref.c }
      : { r: ref.r, c: ref.c + count };
  }

  return ref;
}

/**
 * `shiftSref` shifts a string ref (Sref) along the given axis.
 * Returns `null` if the ref falls in a deleted zone.
 */
export function shiftSref(
  sref: Sref,
  axis: Axis,
  index: number,
  count: number,
): Sref | null {
  const ref = parseRef(sref);
  const shifted = shiftRef(ref, axis, index, count);
  return shifted ? toSref(shifted) : null;
}

/**
 * `shiftFormula` shifts all cell references in a formula string.
 * Uses extractTokens() to find REFERENCE tokens and applies shiftRef to each.
 * Handles range refs (e.g. A1:B3) by shifting each endpoint.
 * Replaces deleted refs with #REF!.
 */
export function shiftFormula(
  formula: string,
  axis: Axis,
  index: number,
  count: number,
): string {
  const tokens = extractTokens(formula);

  // Rebuild formula from tokens, replacing REFERENCE tokens
  let result = '=';
  for (const token of tokens) {
    if (token.type === 'REFERENCE') {
      const text = token.text;
      if (text.includes(':')) {
        // Range reference: shift each endpoint
        const [startStr, endStr] = text.split(':');
        const startRef = parseRef(startStr.toUpperCase());
        const endRef = parseRef(endStr.toUpperCase());
        const newStart = shiftRef(startRef, axis, index, count);
        const newEnd = shiftRef(endRef, axis, index, count);
        if (!newStart || !newEnd) {
          result += '#REF!';
        } else {
          result += toSref(newStart) + ':' + toSref(newEnd);
        }
      } else {
        // Single reference
        const ref = parseRef(text.toUpperCase());
        const shifted = shiftRef(ref, axis, index, count);
        if (!shifted) {
          result += '#REF!';
        } else {
          result += toSref(shifted);
        }
      }
    } else {
      result += token.text;
    }
  }

  return result;
}

/**
 * `shiftDimensionMap` shifts keys in a dimension size map (row heights or column widths)
 * when rows/columns are inserted or deleted.
 * Uses the same insert/delete logic as shiftRef.
 */
export function shiftDimensionMap(
  map: Map<number, number>,
  index: number,
  count: number,
): Map<number, number> {
  const newMap = new Map<number, number>();

  for (const [i, size] of map) {
    if (count > 0) {
      // Insert: shift keys at or after index
      if (i >= index) {
        newMap.set(i + count, size);
      } else {
        newMap.set(i, size);
      }
    } else {
      // Delete: count < 0
      const absCount = Math.abs(count);
      if (i >= index && i < index + absCount) {
        // In deleted zone — drop it
      } else if (i >= index + absCount) {
        newMap.set(i + count, size);
      } else {
        newMap.set(i, size);
      }
    }
  }

  return newMap;
}

/**
 * `shiftGrid` shifts all cells in a grid along the given axis.
 * Returns a new Map with shifted keys and updated formulas.
 */
export function shiftGrid(
  grid: Grid,
  axis: Axis,
  index: number,
  count: number,
): Grid {
  const newGrid: Grid = new Map();

  for (const [sref, cell] of grid) {
    const newSref = shiftSref(sref, axis, index, count);
    if (newSref === null) {
      // Cell is in the deleted zone — skip it
      continue;
    }

    let newCell: Cell;
    if (cell.f) {
      newCell = {
        ...cell,
        f: shiftFormula(cell.f, axis, index, count),
      };
    } else {
      newCell = { ...cell };
    }

    newGrid.set(newSref, newCell);
  }

  return newGrid;
}
