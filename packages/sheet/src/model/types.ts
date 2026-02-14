/**
 * Reference type represents reference to cells in the sheet.
 */
export type Reference = Sref | Srng;

/**
 * Direction type represents the direction of the movement.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Axis type represents the axis of the sheet.
 */
export type Axis = 'row' | 'column';

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
 * TextAlign represents the horizontal text alignment of a cell.
 */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * VerticalAlign represents the vertical text alignment of a cell.
 */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * NumberFormat represents the number format of a cell.
 */
export type NumberFormat = 'plain' | 'number' | 'currency' | 'percent';

/**
 * CellStyle represents the formatting style of a cell.
 */
export type CellStyle = {
  b?: boolean; // bold
  i?: boolean; // italic
  u?: boolean; // underline
  st?: boolean; // strikethrough
  tc?: string; // text color (#hex)
  bg?: string; // background color (#hex)
  al?: TextAlign; // horizontal alignment
  va?: VerticalAlign; // vertical alignment
  nf?: NumberFormat; // number format
  dp?: number; // decimal places (for number/currency/percent formats)
};

/**
 * Cell type represents a cell in the sheet.
 */
export type Cell = {
  v?: string;
  f?: string;
  s?: CellStyle;
};

/**
 * Grid type represents a grid of rows and columns.
 */
export type Grid = Map<Sref, Cell>;

/**
 * SelectionType represents the type of selection.
 */
export type SelectionType = 'cell' | 'row' | 'column' | 'all';
