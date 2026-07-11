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
 * ARef (Absolute-aware Ref) extends Ref with optional absolute-reference flags.
 * Used during formula relocation to decide which axes should stay fixed.
 */
export type ARef = Ref & {
  absCol?: boolean;
  absRow?: boolean;
};

/**
 * Range type represents a range of cells in the sheet.
 */
export type Range = [Ref, Ref];

/**
 * Ranges type represents multiple disjoint ranges.
 */
export type Ranges = Range[];

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
export type NumberFormat = 'plain' | 'number' | 'currency' | 'percent' | 'date';

/**
 * BorderPreset represents a border application preset for a selected range.
 */
export type BorderPreset =
  | 'all'
  | 'outer'
  | 'inner'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'clear';

/**
 * CellStyle represents the formatting style of a cell.
 */
export type CellStyle = {
  b?: boolean; // bold
  i?: boolean; // italic
  u?: boolean; // underline
  st?: boolean; // strikethrough
  bt?: boolean; // top border
  br?: boolean; // right border
  bb?: boolean; // bottom border
  bl?: boolean; // left border
  tc?: string; // text color (#hex)
  bg?: string; // background color (#hex)
  al?: TextAlign; // horizontal alignment
  va?: VerticalAlign; // vertical alignment
  nf?: NumberFormat; // number format
  cu?: string; // currency code (e.g. KRW, USD) when nf is currency
  dp?: number; // decimal places (for number/currency/percent formats)
};

/**
 * Conditional formatting operators.
 */
export type ConditionalFormatOperator =
  | 'isEmpty'
  | 'isNotEmpty'
  | 'textContains'
  | 'greaterThan'
  | 'between'
  | 'dateBefore'
  | 'dateAfter';

/**
 * Conditional formatting supports a focused subset of text/fill styles.
 */
export type ConditionalFormatStyle = Partial<
  Pick<CellStyle, 'b' | 'i' | 'u' | 'tc' | 'bg'>
>;

/**
 * Conditional formatting rule.
 */
export type ConditionalFormatRule = {
  id: string;
  ranges: Range[];
  op: ConditionalFormatOperator;
  value?: string;
  value2?: string;
  style: ConditionalFormatStyle;
};

/**
 * DataValidationKind enumerates the in-cell control kinds.
 */
export type DataValidationKind = 'checkbox' | 'list' | 'date';

/**
 * DataValidationOperator enumerates the comparison operators. Date operators
 * ship first; number/text operators reuse this union later.
 */
export type DataValidationOperator =
  | 'dateValid'
  | 'dateEquals'
  | 'dateBefore'
  | 'dateOnOrBefore'
  | 'dateAfter'
  | 'dateOnOrAfter'
  | 'dateBetween'
  | 'dateNotBetween';

/**
 * DataValidationRule is a worksheet-level, range-scoped validation/control
 * rule. The control is a special render of a typed cell value — the cell
 * itself holds the value (boolean TRUE/FALSE, ISO date, or list text).
 */
export type DataValidationRule = {
  id: string;
  ranges: Range[];
  kind: DataValidationKind;
  onInvalid?: 'reject' | 'warning'; // list/date only; ignored for checkbox

  // kind: 'list'
  list?: string[];
  showArrow?: boolean;

  // kind: 'checkbox'
  checkedValue?: string;
  uncheckedValue?: string;

  // kind: 'date' (operator + fixed-date operands; future: number/text)
  operator?: DataValidationOperator;
  values?: string[]; // ISO operands; length by operator (0/1/2)
};

/**
 * Cell type represents a cell in the sheet.
 *
 * Spill fields support dynamic-array formulas (e.g. MMULT, MINVERSE):
 *   - The anchor cell (the one with the formula) stores `spillRows`/`spillCols`
 *     so the calculator knows how many ghost cells to clear on recalculation.
 *   - Each ghost cell stores `spillAnchor` pointing back to the anchor's Sref.
 */
export type Cell = {
  v?: string;
  f?: string;
  s?: CellStyle;
  spillRows?: number;
  spillCols?: number;
  spillAnchor?: Sref;
  spillBlocked?: boolean;
};

/**
 * MergeSpan represents a merged cell block size from an anchor cell.
 * `rs` = row span, `cs` = column span.
 */
export type MergeSpan = {
  rs: number;
  cs: number;
};

/**
 * Filter operators for column-level filtering.
 */
export type FilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'in';

/**
 * Filter condition for a single column.
 */
export type FilterCondition = {
  op: FilterOperator;
  value?: string;
  values?: string[];
};

/**
 * FilterState stores filter range, per-column criteria, and computed hidden rows.
 */
export type FilterState = {
  range: Range;
  columns: Record<string, FilterCondition>;
  hiddenRows: number[];
};

/**
 * HiddenState stores manually hidden row and column indices.
 */
export type HiddenState = {
  rows: number[];
  columns: number[];
};

/**
 * AggregateFunction represents the aggregation functions available in pivot tables.
 */
export type AggregateFunction =
  | 'SUM'
  | 'COUNT'
  | 'COUNTA'
  | 'AVERAGE'
  | 'MIN'
  | 'MAX';

/**
 * PivotFieldSort represents the sort direction for a pivot field.
 */
export type PivotFieldSort = 'asc' | 'desc';

/**
 * PivotField represents a row or column field in a pivot table.
 */
export type PivotField = {
  sourceColumn: number;
  label: string;
  sort?: PivotFieldSort;
};

/**
 * PivotValueField represents a value field with an aggregation function.
 */
export type PivotValueField = PivotField & {
  aggregation: AggregateFunction;
};

/**
 * PivotFilterField represents a filter field with hidden values.
 */
export type PivotFilterField = PivotField & {
  hiddenValues: string[];
};

/**
 * PivotTableDefinition describes the full configuration of a pivot table.
 */
export type PivotTableDefinition = {
  id: string;
  sourceTabId: string;
  sourceRange: string;
  rowFields: PivotField[];
  columnFields: PivotField[];
  valueFields: PivotValueField[];
  filterFields: PivotFilterField[];
  showTotals: {
    rows: boolean;
    columns: boolean;
  };
};

/**
 * PivotRecord represents a single data record as an array of string values.
 */
export type PivotRecord = string[];

/**
 * GroupNode represents a node in the pivot table grouping tree.
 */
export type GroupNode = {
  value: string;
  children: GroupNode[];
  records: number[];
};

/**
 * PivotCellType represents the type of a cell in the pivot table output.
 */
export type PivotCellType =
  | 'rowHeader'
  | 'colHeader'
  | 'value'
  | 'total'
  | 'empty';

/**
 * PivotCellFormat is the subset of CellStyle that a pivot cell inherits from
 * its source column (number format, decimal places, currency code).
 */
export type PivotCellFormat = Pick<CellStyle, 'nf' | 'dp' | 'cu'>;

/**
 * PivotCell represents a single cell in the pivot table output.
 */
export type PivotCell = {
  value: string;
  type: PivotCellType;
  /**
   * Format inherited from the source column, applied to the materialized
   * cell so labels/values render with the source's number/date format.
   */
  format?: PivotCellFormat;
};

/**
 * PivotResult represents the computed output of a pivot table.
 */
export type PivotResult = {
  cells: PivotCell[][];
  rowCount: number;
  colCount: number;
};

/**
 * Grid type represents a grid of rows and columns.
 */
export type Grid = Map<Sref, Cell>;

/**
 * SelectionType represents the type of selection.
 */
export type SelectionType = 'cell' | 'row' | 'column' | 'all';

/**
 * GridResolver resolves cell data from other sheets.
 * Takes a sheet name + set of cell refs, returns a Grid with those cells' data,
 * or undefined if the sheet doesn't exist.
 */
export type GridResolver = (
  sheetName: string,
  refs: Set<Sref>,
) => Grid | undefined;

/**
 * FormulaResolver returns formula strings from other sheets.
 * Takes a sheet name, returns a Map from local Sref to formula string,
 * or undefined if the sheet doesn't exist.
 */
export type FormulaResolver = (
  sheetName: string,
) => Map<Sref, string> | undefined;
