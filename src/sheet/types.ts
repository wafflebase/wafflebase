/**
 * Reference type represents reference to cells in the sheet.
 */
export type Reference = Sref | Srng;

/**
 * Sref type represents a reference to a cell in the sheet.
 * e.g. A1, B2, C3, etc.
 */
export type Sref = string;

/**
 * Srng type represents a range of cells in the sheet.
 * e.g. A1:B2, C3:D4, etc.
 */
export type Srng = string;

/**
 * Ref type represents the id of a cell in the sheet.
 */
export type Ref = {
  r: number;
  c: number;
};

/**
 * Range type represents a range of cells in the sheet.
 */
export type Range = [Ref, Ref];

/**
 * Cell type represents a cell in the sheet.
 */
export type Cell = {
  v?: string;
  f?: string;
};

/**
 * Grid type represents a grid of rows and columns.
 */
export type Grid = Map<Sref, Cell>;
