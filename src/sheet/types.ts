/**
 * Reference type represents a reference to a cell in the sheet.
 * e.g. A1, B2, C3, etc.
 * TODO(hackerwins): We need to support references across sheets.
 */
export type Reference = string;

/**
 * Range type represents a range of cells in the sheet.
 * e.g. A1:B2, C3:D4, etc.
 */
export type Range = string;

/**
 * Grid type represents a grid of rows and columns.
 * Indexes are 1-based.
 */
export type Grid = Map<Reference, Cell>;

/**
 * Cell type represents a cell in the sheet.
 */
export type Cell = {
  v?: string;
  f?: string;
};

/**
 * CellIndex type represents the index of a cell in the sheet.
 */
export type CellIndex = {
  row: number;
  col: number;
};
