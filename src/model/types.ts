/**
 * Grid type represents a grid of rows and columns.
 * Indexes are 1-based.
 */
export type Grid = Map<number, Row>;
/**
 * Row type represents a row in the sheet.
 */
export type Row = Map<number, Cell>;

/**
 * Cell type represents a cell in the sheet.
 */
export type Cell = number | null;

/**
 * CellIndex type represents the index of a cell in the sheet.
 */
export type CellIndex = {
  row: number;
  col: number;
};
