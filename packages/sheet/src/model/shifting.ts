import { extractTokens } from '../formula/formula';
import { parseARef, parseRef, toASref, toSref } from './coordinates';
import { ARef, Axis, Cell, Grid, Ref, Sref } from './types';

/**
 * `remapIndex` maps an old 1-based index to its new position after moving
 * `count` items starting at `src` to before `dst`.
 *
 * - Items in [src, src+count) → destination block
 * - Items between shift forward or backward to fill the gap
 * - Items outside the affected range are unchanged
 */
export function remapIndex(
  i: number,
  src: number,
  count: number,
  dst: number,
): number {
  const srcEnd = src + count;

  if (dst <= src) {
    // Moving backward: source block goes to dst, items in [dst, src) shift forward
    if (i >= src && i < srcEnd) {
      return dst + (i - src);
    }
    if (i >= dst && i < src) {
      return i + count;
    }
    return i;
  }

  // Moving forward: source block goes to dst-count, items in [srcEnd, dst) shift backward
  if (i >= src && i < srcEnd) {
    return dst - count + (i - src);
  }
  if (i >= srcEnd && i < dst) {
    return i - count;
  }
  return i;
}

/**
 * `moveRef` remaps a Ref using `remapIndex` for the given axis.
 */
export function moveRef(
  ref: Ref,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): Ref {
  if (axis === 'row') {
    return { r: remapIndex(ref.r, src, count, dst), c: ref.c };
  }
  return { r: ref.r, c: remapIndex(ref.c, src, count, dst) };
}

/**
 * `moveFormula` remaps all cell references in a formula string
 * after moving `count` rows/columns from `src` to before `dst`.
 */
export function moveFormula(
  formula: string,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): string {
  const tokens = extractTokens(formula);

  let result = '=';
  for (const token of tokens) {
    if (token.type === 'REFERENCE') {
      const text = token.text;
      if (text.includes('!')) {
        // Cross-sheet ref — don't shift
        result += text;
      } else if (text.includes(':')) {
        const [startStr, endStr] = text.split(':');
        const startARef = parseARef(startStr.toUpperCase());
        const endARef = parseARef(endStr.toUpperCase());
        const newStart = moveRef(startARef, axis, src, count, dst);
        const newEnd = moveRef(endARef, axis, src, count, dst);
        result += toASref({ ...newStart, ...(startARef.absCol ? { absCol: true } : {}), ...(startARef.absRow ? { absRow: true } : {}) }) + ':' + toASref({ ...newEnd, ...(endARef.absCol ? { absCol: true } : {}), ...(endARef.absRow ? { absRow: true } : {}) });
      } else {
        const aref = parseARef(text.toUpperCase());
        const moved = moveRef(aref, axis, src, count, dst);
        result += toASref({ ...moved, ...(aref.absCol ? { absCol: true } : {}), ...(aref.absRow ? { absRow: true } : {}) });
      }
    } else {
      result += token.text;
    }
  }

  return result;
}

/**
 * `moveGrid` remaps all cell keys and their formulas after moving
 * `count` rows/columns from `src` to before `dst`.
 */
export function moveGrid(
  grid: Grid,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): Grid {
  const newGrid: Grid = new Map();

  for (const [sref, cell] of grid) {
    const ref = parseRef(sref);
    const newRef = moveRef(ref, axis, src, count, dst);
    const newSref = toSref(newRef);

    let newCell: Cell;
    if (cell.f) {
      newCell = {
        ...cell,
        f: moveFormula(cell.f, axis, src, count, dst),
      };
    } else {
      newCell = { ...cell };
    }

    newGrid.set(newSref, newCell);
  }

  return newGrid;
}

/**
 * `moveDimensionMap` remaps dimension size keys after moving
 * `count` items from `src` to before `dst`.
 */
export function moveDimensionMap<T = number>(
  map: Map<number, T>,
  src: number,
  count: number,
  dst: number,
): Map<number, T> {
  const newMap = new Map<number, T>();

  for (const [i, size] of map) {
    newMap.set(remapIndex(i, src, count, dst), size);
  }

  return newMap;
}

/**
 * `relocateARef` shifts an ARef by deltas, skipping absolute axes.
 */
function relocateARef(ref: ARef, deltaRow: number, deltaCol: number): ARef {
  return {
    r: ref.absRow ? ref.r : ref.r + deltaRow,
    c: ref.absCol ? ref.c : ref.c + deltaCol,
    ...(ref.absCol ? { absCol: true } : {}),
    ...(ref.absRow ? { absRow: true } : {}),
  };
}

/**
 * `relocateFormula` adjusts all cell references in a formula by the given
 * row and column deltas. Used when copy-pasting formulas to a new location.
 * Returns a formula with `#REF!` if any reference goes below row 1 or column 1.
 */
export function relocateFormula(
  formula: string,
  deltaRow: number,
  deltaCol: number,
): string {
  const tokens = extractTokens(formula);

  let result = '=';
  for (const token of tokens) {
    if (token.type === 'REFERENCE') {
      const text = token.text;
      if (text.includes('!')) {
        // Cross-sheet ref — don't relocate
        result += text;
      } else if (text.includes(':')) {
        const [startStr, endStr] = text.split(':');
        const startRef = relocateARef(parseARef(startStr.toUpperCase()), deltaRow, deltaCol);
        const endRef = relocateARef(parseARef(endStr.toUpperCase()), deltaRow, deltaCol);
        if (startRef.r < 1 || startRef.c < 1 || endRef.r < 1 || endRef.c < 1) {
          result += '#REF!';
        } else {
          result += toASref(startRef) + ':' + toASref(endRef);
        }
      } else {
        const ref = relocateARef(parseARef(text.toUpperCase()), deltaRow, deltaCol);
        if (ref.r < 1 || ref.c < 1) {
          result += '#REF!';
        } else {
          result += toASref(ref);
        }
      }
    } else {
      result += token.text;
    }
  }

  return result;
}

/**
 * `applyAbsMarkers` copies the absolute markers from an ARef onto a plain Sref.
 */
function applyAbsMarkers(aref: ARef, sref: Sref): Sref {
  const parsed = parseRef(sref);
  return toASref({
    ...parsed,
    ...(aref.absCol ? { absCol: true } : {}),
    ...(aref.absRow ? { absRow: true } : {}),
  });
}

/**
 * `redirectFormula` rewrites cell references in a formula using an explicit
 * old->new mapping. Used when cut-pasting cells so that other formulas
 * pointing at the moved cells are updated to the new locations.
 *
 * Range references (e.g. `A1:B3`) are only redirected when both endpoints
 * appear in the map. Cross-sheet references are never redirected.
 */
export function redirectFormula(
  formula: string,
  refMap: Map<Sref, Sref>,
): string {
  const tokens = extractTokens(formula);

  let result = '=';
  for (const token of tokens) {
    if (token.type === 'REFERENCE') {
      const text = token.text;
      if (text.includes('!')) {
        // Cross-sheet ref — don't redirect
        result += text;
      } else if (text.includes(':')) {
        const [startStr, endStr] = text.split(':');
        const startARef = parseARef(startStr.toUpperCase());
        const endARef = parseARef(endStr.toUpperCase());
        const startSref = toSref(startARef);
        const endSref = toSref(endARef);
        const newStart = refMap.get(startSref);
        const newEnd = refMap.get(endSref);
        if (newStart && newEnd) {
          result += applyAbsMarkers(startARef, newStart) + ':' + applyAbsMarkers(endARef, newEnd);
        } else {
          result += text;
        }
      } else {
        const aref = parseARef(text.toUpperCase());
        const sref = toSref(aref);
        const newSref = refMap.get(sref);
        result += newSref ? applyAbsMarkers(aref, newSref) : text;
      }
    } else {
      result += token.text;
    }
  }

  return result;
}

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
  const aref = parseARef(sref);
  const shifted = shiftRef(aref, axis, index, count);
  if (!shifted) return null;
  return toASref({
    ...shifted,
    ...(aref.absCol ? { absCol: true } : {}),
    ...(aref.absRow ? { absRow: true } : {}),
  });
}

/**
 * `shiftARef` shifts an ARef and preserves absolute markers.
 * Insert/delete shifts even absolute refs (Excel behavior), but the `$` flags are kept.
 */
function shiftARef(
  ref: ARef,
  axis: Axis,
  index: number,
  count: number,
): ARef | null {
  const shifted = shiftRef(ref, axis, index, count);
  if (!shifted) return null;
  return {
    ...shifted,
    ...(ref.absCol ? { absCol: true } : {}),
    ...(ref.absRow ? { absRow: true } : {}),
  };
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
      if (text.includes('!')) {
        // Cross-sheet ref — don't shift
        result += text;
      } else if (text.includes(':')) {
        // Range reference: shift each endpoint
        const [startStr, endStr] = text.split(':');
        const newStart = shiftARef(parseARef(startStr.toUpperCase()), axis, index, count);
        const newEnd = shiftARef(parseARef(endStr.toUpperCase()), axis, index, count);
        if (!newStart || !newEnd) {
          result += '#REF!';
        } else {
          result += toASref(newStart) + ':' + toASref(newEnd);
        }
      } else {
        // Single reference
        const shifted = shiftARef(parseARef(text.toUpperCase()), axis, index, count);
        if (!shifted) {
          result += '#REF!';
        } else {
          result += toASref(shifted);
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
export function shiftDimensionMap<T = number>(
  map: Map<number, T>,
  index: number,
  count: number,
): Map<number, T> {
  const newMap = new Map<number, T>();

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
