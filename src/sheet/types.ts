/**
 * Reference type represents reference to cells in the sheet.
 */
export type Reference = Ref | RefRange;

/**
 * Ref type represents a reference to a cell in the sheet.
 * e.g. A1, B2, C3, etc.
 */
export type Ref = string;

/**
 * RefRange type represents a range of cells in the sheet.
 * e.g. A1:B2, C3:D4, etc.
 */
export type RefRange = string;

/**
 * Grid type represents a grid of rows and columns.
 * Indexes are 1-based.
 */
export type Grid = Map<Ref, Cell>;

/**
 * Cell type represents a cell in the sheet.
 */
export type Cell = {
  v?: string;
  f?: string;
};

/**
 * CellRange type represents a range of cells in the sheet.
 */
export type CellRange = [CellID, CellID];

/**
 * CellID type represents the id of a cell in the sheet.
 */
export type CellID = {
  row: number;
  col: number;
};
