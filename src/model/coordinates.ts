import { CellIndex } from "./types";

/**
 * createCellIndices generates the cell indices from the given range.
 */
export function* generateCellIndices(
  from: CellIndex,
  to: CellIndex
): Generator<CellIndex> {
  for (let row = from.row; row <= to.row; row++) {
    for (let col = from.col; col <= to.col; col++) {
      yield { row, col };
    }
  }
}

/**
 * parseCellReference parses the cell reference and returns the cell index.
 */
export function parseCellReference(cellReference: string): CellIndex {
  let startRow = 0;
  for (let i = 0; i < cellReference.length; i++) {
    const charCode = cellReference.charCodeAt(i);
    if (48 <= charCode && charCode <= 57) {
      startRow = i;
      break;
    }
  }

  if (startRow === 0) {
    throw new Error("Invalid Reference");
  }

  const row = parseInt(cellReference.substring(startRow));
  const col = cellReference
    .substring(0, startRow)
    .split("")
    .reverse()
    .reduce((acc, char, index) => {
      return acc + Math.pow(26, index) * (char.charCodeAt(0) - 65 + 1);
    }, 0);

  if (isNaN(row) || isNaN(col)) {
    throw new Error("Invalid Reference");
  }

  return { row, col };
}

/**
 * parseRangeReference parses the range reference and returns the cell indices.
 */
export function parseRangeReference(
  rangeReference: string
): [CellIndex, CellIndex] {
  const [from, to] = rangeReference.split(":");
  return [parseCellReference(from), parseCellReference(to)];
}
