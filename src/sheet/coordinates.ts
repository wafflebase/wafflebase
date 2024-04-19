import { CellID, CellRange, Reference, Ref } from './types';

/**
 * `toCellIDs` generates cellIDs from the given range.
 */
export function* toCellIDs(range: CellRange): Generator<CellID> {
  const [from, to] = range;

  for (let row = from.row; row <= to.row; row++) {
    for (let col = from.col; col <= to.col; col++) {
      yield { row, col };
    }
  }
}

/**
 * `isSameID` returns whether the given cellIDs are the same.
 */
export function isSameID(id1: CellID, id2: CellID): boolean {
  return id1.row === id2.row && id1.col === id2.col;
}

/**
 * `cloneID` clones the given cellID.
 */
export function cloneID(id: CellID): CellID {
  return { row: id.row, col: id.col };
}

/**
 * `cloneRange` clones the given range.
 */
export function cloneRange(range: CellRange): CellRange {
  return [cloneID(range[0]), cloneID(range[1])];
}

/**
 * `isRangeRef` returns whether Reference is RangeRef.
 */
export function isRangeRef(reference: Reference): boolean {
  return reference.includes(':');
}

/**
 * `toRefs` converts the references to Refs. If the reference is a range,
 *  it decomposes the range into individual references.
 */
export function* toRefs(references: Set<Reference>): Generator<Ref> {
  for (const reference of references) {
    if (isRangeRef(reference)) {
      const range = parseRefRange(reference);
      for (const id of toCellIDs(range)) {
        yield toRef(id);
      }
      continue;
    }

    yield reference;
  }
}

/**
 * `toRef` converts the given id to Ref.
 * @param id
 */
export function toRef(id: CellID): Ref {
  return toColumnLabel(id.col) + id.row;
}

/**
 * `toColumnLabel` converts the column to the column label.
 */
export function toColumnLabel(col: number): string {
  let columnLabel = '';
  while (col > 0) {
    const rem = col % 26;
    if (rem === 0) {
      columnLabel = 'Z' + columnLabel;
      col = Math.floor(col / 26) - 1;
    } else {
      columnLabel = String.fromCharCode(rem + 64) + columnLabel;
      col = Math.floor(col / 26);
    }
  }
  return columnLabel;
}

/**
 * parseRef parses the ref and returns CellID.
 */
export function parseRef(ref: Ref): CellID {
  let startRow = 0;
  for (let i = 0; i < ref.length; i++) {
    const charCode = ref.charCodeAt(i);
    if (48 <= charCode && charCode <= 57) {
      startRow = i;
      break;
    }
  }

  if (startRow === 0) {
    throw new Error('Invalid Reference');
  }

  const row = parseInt(ref.substring(startRow));
  const col = ref
    .substring(0, startRow)
    .split('')
    .reverse()
    .reduce((acc, char, index) => {
      return acc + Math.pow(26, index) * (char.charCodeAt(0) - 65 + 1);
    }, 0);

  if (isNaN(row) || isNaN(col)) {
    throw new Error('Invalid Reference');
  }

  return { row, col };
}

/**
 * parseRangeReference parses the range reference and returns the cell indices.
 */
export function parseRefRange(range: string): CellRange {
  const [from, to] = range.split(':');
  return [parseRef(from), parseRef(to)];
}
