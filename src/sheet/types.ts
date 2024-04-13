/**
 * Reference type represents a reference to a cell in the sheet.
 */
export type Reference = string;

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
