import {
  formatValue,
  getWorksheetCell,
  parseRef,
  resolveWorksheetCellStyle,
  toSref,
  type CellStyle,
  type Spreadsheet,
} from "@wafflebase/sheets";
import type { SheetChart, SpreadsheetDocument } from "@/types/worksheet";
export { COLOR_PALETTES, getSeriesColor } from "./chart-colors";
import { getSeriesColor } from "./chart-colors";

type ParsedRange = readonly [
  { r: number; c: number },
  { r: number; c: number },
];

type ChartSourceSheet = SpreadsheetDocument["sheets"][string];

export type ChartSeries = {
  key: string;
  label: string;
};

/**
 * The number format of the charted values, when it is one the value axis
 * should repeat (a currency or percent column ticks as `$1,200` / `12%`).
 */
export type ChartValueFormat = {
  nf: NonNullable<CellStyle["nf"]>;
  dp?: number;
  cu?: string;
};

export type ChartDataset = {
  xKey: string;
  rows: Array<Record<string, string | number>>;
  series: ChartSeries[];
  config: Record<string, { label: string; color: string }>;
  valueFormat?: ChartValueFormat;
};

/**
 * `xAxisColumn` value meaning "no label column": every column is a series
 * and categories are row positions. Distinct from `undefined`, which means
 * "decide from the data" (`detectChartSourceLayout`). An empty string can
 * never name a column, so it cannot collide with one.
 */
export const NO_X_AXIS_COLUMN = "";

/**
 * How a chart's source range is laid out, as Google Sheets guesses it:
 * whether the first row names the series and whether the first column
 * labels the categories.
 */
export type ChartSourceLayout = {
  headerRow: boolean;
  labelColumn: boolean;
};

export type PieDatasetEntry = { name: string; value: number; color: string };
export type PieDataset = { entries: PieDatasetEntry[] };

export type ChartColumnOption = {
  column: string;
  index: number;
  label: string;
};

export type ChartColumnSelection = {
  columns: ChartColumnOption[];
  xAxisColumn: string | null;
  seriesColumns: string[];
};

/**
 * Parses a1 range.
 */
export function parseA1Range(input: unknown): ParsedRange | null {
  if (typeof input !== "string") {
    return null;
  }

  const tokens = input
    .toUpperCase()
    .replace(/\$/g, "")
    .split(":")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length !== 2) {
    return null;
  }

  try {
    const a = parseRef(tokens[0]);
    const b = parseRef(tokens[1]);
    return [
      { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
      { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
    ] as const;
  } catch {
    return null;
  }
}

/**
 * Formats a1 range.
 */
export function formatA1Range(range: ParsedRange): string {
  return `${toSref(range[0])}:${toSref(range[1])}`;
}

/**
 * `detectChartSourceLayout` guesses whether `range` carries a header row and
 * a label column, the way Google Sheets does when a chart is inserted:
 *
 * - The first row is a header when some column has non-numeric text there
 *   over numeric data below. A range of numbers only has no header, so its
 *   first row is charted instead of becoming series names like "1200". A
 *   range with no numbers below row 1 at all keeps the header assumption,
 *   since nothing in it could chart anyway.
 * - The first column labels the categories when its data cells hold text,
 *   or when there is a header row (a "Year" column of 2024, 2025 is labels).
 *   Numbers-only data with no header has no label column: every column is a
 *   series.
 */
export function detectChartSourceLayout(
  sheet: ChartSourceSheet | undefined,
  range: ParsedRange,
): ChartSourceLayout {
  const [from, to] = range;
  if (!sheet || to.r <= from.r) {
    return { headerRow: true, labelColumn: true };
  }

  let textOverNumbers = false;
  let anyNumberBelow = false;
  for (let c = from.c; c <= to.c; c++) {
    let numberBelow = false;
    for (let r = from.r + 1; r <= to.r; r++) {
      if (toNumeric(getCellRawValue(sheet, r, c)) !== null) {
        numberBelow = true;
        break;
      }
    }
    anyNumberBelow ||= numberBelow;
    const head = getCellRawValue(sheet, from.r, c).trim();
    if (numberBelow && head !== "" && toNumeric(head) === null) {
      textOverNumbers = true;
    }
  }
  const headerRow = textOverNumbers || !anyNumberBelow;

  let textLabels = false;
  for (let r = headerRow ? from.r + 1 : from.r; r <= to.r; r++) {
    const value = getCellRawValue(sheet, r, from.c).trim();
    if (value !== "" && toNumeric(value) === null) {
      textLabels = true;
      break;
    }
  }

  return { headerRow, labelColumn: headerRow || textLabels };
}

/**
 * Returns default chart columns: the first column as the X-axis and the rest
 * as series, or — when `layout` says there is no label column — every
 * column as a series and `NO_X_AXIS_COLUMN`.
 */
export function getDefaultChartColumns(
  range: ParsedRange,
  layout?: ChartSourceLayout,
): {
  xAxisColumn: string | null;
  seriesColumns: string[];
} {
  const [from, to] = range;
  const columns: string[] = [];
  for (let c = from.c; c <= to.c; c++) {
    columns.push(toColumnName(c));
  }

  if (columns.length === 0) {
    return { xAxisColumn: null, seriesColumns: [] };
  }

  if (layout && !layout.labelColumn) {
    return { xAxisColumn: NO_X_AXIS_COLUMN, seriesColumns: columns };
  }

  return {
    xAxisColumn: columns[0],
    seriesColumns: columns.slice(1),
  };
}

/**
 * `getDefaultChartTitle` names a new chart after what it plots, as Google
 * Sheets does: the series header ("Revenue"), two joined ("Revenue and
 * Cost"), and the X-axis header when there is one ("… by Month"). A range
 * without headers has nothing to name it by, so it stays "Chart".
 */
export function getDefaultChartTitle(
  root: SpreadsheetDocument,
  chart: Pick<
    SheetChart,
    "sourceTabId" | "sourceRange" | "xAxisColumn" | "seriesColumns"
  >,
): string {
  const sheet = root.sheets[chart.sourceTabId];
  const parsed = parseA1Range(chart.sourceRange);
  if (!sheet || !parsed) return "Chart";
  if (!detectChartSourceLayout(sheet, parsed).headerRow) return "Chart";

  const selection = resolveChartColumns(root, chart);
  const headerOf = (column: string | null) => {
    const index = column ? toColumnIndex(column) : null;
    return index ? getCellRawValue(sheet, parsed[0].r, index).trim() : "";
  };

  const names = selection.seriesColumns.map(headerOf).filter(Boolean);
  if (names.length === 0) return "Chart";
  const series =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  if (names.length === 1) return series;
  const axis = headerOf(selection.xAxisColumn);
  return axis ? `${series} by ${axis}` : series;
}

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * `placeNewChart` picks where a new chart goes, in one screen coordinate
 * system for `source` (the charted range), `visible` (the scrollable grid
 * area) and the result. Google Sheets never drops a new chart onto its own
 * data: it goes to the right of the range, else below it, kept inside the
 * visible area when it fits; with no room either way it still goes to the
 * right, off screen, rather than over the cells.
 */
export function placeNewChart({
  source,
  visible,
  size,
  gap,
}: {
  source: Box;
  visible: Box;
  size: { width: number; height: number };
  gap: number;
}): { side: "right" | "below"; left: number; top: number } {
  // Beside the range, aligned with its top row — but never above the
  // visible area, and pulled up when the bottom would run off screen. A
  // range scrolled entirely out to the left still gets a chart that starts
  // inside the viewport: past its right edge either way, so never over it.
  const right = {
    side: "right" as const,
    left: Math.max(source.right + gap, visible.left + gap),
    top: Math.max(
      visible.top + gap,
      Math.min(source.top, visible.bottom - size.height - gap),
    ),
  };
  if (right.left + size.width <= visible.right) {
    return right;
  }

  // Likewise a range scrolled entirely out above starts the chart inside.
  const belowTop = Math.max(source.bottom + gap, visible.top + gap);
  if (belowTop + size.height <= visible.bottom) {
    const left = Math.max(
      visible.left + gap,
      Math.min(source.left, visible.right - size.width - gap),
    );
    return { side: "below", left, top: belowTop };
  }

  return right;
}

/** Logical-pixel gap between a new chart and its source range. */
const NEW_CHART_GAP = 8;

type PlacementGeometry = Pick<
  Spreadsheet,
  | "getCellRectInScrollableViewport"
  | "getGridViewportRect"
  | "getScrollableGridViewportRect"
  | "getZoom"
>;

/**
 * `computeNewChartPlacement` turns `placeNewChart` into what a chart stores:
 * an anchor cell beside (or below) the source range plus a logical-pixel
 * offset from it, so the chart keeps its place beside the data as rows and
 * columns change.
 */
export function computeNewChartPlacement(
  geometry: PlacementGeometry,
  range: ParsedRange,
  size: { width: number; height: number },
): { anchor: string; offsetX: number; offsetY: number } {
  const [from, to] = range;
  const besideRef = { r: from.r, c: to.c + 1 };
  try {
    const zoom = geometry.getZoom() || 1;
    const first = geometry.getCellRectInScrollableViewport(from);
    const last = geometry.getCellRectInScrollableViewport(to);
    // Object layers are positioned in grid-viewport coordinates; the
    // scrollable quadrant is the part not covered by headers or a freeze.
    const grid = geometry.getGridViewportRect();
    const scrollable = geometry.getScrollableGridViewportRect();
    const visibleLeft = scrollable.left - grid.left;
    const visibleTop = scrollable.top - grid.top;

    const placed = placeNewChart({
      source: {
        left: first.left,
        top: first.top,
        right: last.left + last.width,
        bottom: last.top + last.height,
      },
      visible: {
        left: visibleLeft,
        top: visibleTop,
        right: visibleLeft + scrollable.width,
        bottom: visibleTop + scrollable.height,
      },
      size: { width: size.width * zoom, height: size.height * zoom },
      gap: NEW_CHART_GAP * zoom,
    });

    const anchorRef =
      placed.side === "right" ? besideRef : { r: to.r + 1, c: from.c };
    const anchorRect = geometry.getCellRectInScrollableViewport(anchorRef);
    return {
      anchor: toSref(anchorRef),
      offsetX: Math.round((placed.left - anchorRect.left) / zoom),
      offsetY: Math.round((placed.top - anchorRect.top) / zoom),
    };
  } catch {
    return { anchor: toSref(besideRef), offsetX: NEW_CHART_GAP, offsetY: 0 };
  }
}

/**
 * Resolves chart columns.
 */
export function resolveChartColumns(
  root: SpreadsheetDocument,
  chart: Pick<
    SheetChart,
    "sourceTabId" | "sourceRange" | "xAxisColumn" | "seriesColumns"
  >,
): ChartColumnSelection {
  const sourceSheet = root.sheets[chart.sourceTabId];
  if (!sourceSheet) {
    return { columns: [], xAxisColumn: null, seriesColumns: [] };
  }

  const parsed = parseA1Range(chart.sourceRange);
  if (!parsed) {
    return { columns: [], xAxisColumn: null, seriesColumns: [] };
  }

  const [from, to] = parsed;
  const layout = detectChartSourceLayout(sourceSheet, parsed);
  const columns: ChartColumnOption[] = [];
  for (let c = from.c; c <= to.c; c++) {
    const column = toColumnName(c);
    columns.push({
      column,
      index: c,
      label: getColumnLabel(sourceSheet, from.r, c, layout.headerRow),
    });
  }

  if (columns.length === 0) {
    return { columns: [], xAxisColumn: null, seriesColumns: [] };
  }

  // An explicit column wins; NO_X_AXIS_COLUMN means none; anything else
  // (unset, or a column no longer in the range) follows the data.
  const requestedXAxis = normalizeColumnName(chart.xAxisColumn);
  const xAxisColumn = columns.some((column) => column.column === requestedXAxis)
    ? requestedXAxis
    : chart.xAxisColumn === NO_X_AXIS_COLUMN || !layout.labelColumn
      ? null
      : columns[0].column;

  const seen = new Set<string>();
  const seriesColumns: string[] = [];

  const configuredSeries = chart.seriesColumns ?? [];
  for (const rawColumn of configuredSeries) {
    const column = normalizeColumnName(rawColumn);
    if (
      column &&
      column !== xAxisColumn &&
      !seen.has(column) &&
      columns.some((candidate) => candidate.column === column)
    ) {
      seen.add(column);
      seriesColumns.push(column);
    }
  }

  if (chart.seriesColumns === undefined) {
    for (const column of columns) {
      if (column.column !== xAxisColumn) {
        seriesColumns.push(column.column);
      }
    }
  }

  return { columns, xAxisColumn, seriesColumns };
}

/**
 * Builds chart dataset.
 */
export function buildChartDataset(
  root: SpreadsheetDocument,
  chart: Pick<
    SheetChart,
    "sourceTabId" | "sourceRange" | "xAxisColumn" | "seriesColumns"
  >,
  palette?: string,
): ChartDataset {
  const sourceSheet = root.sheets[chart.sourceTabId];
  if (!sourceSheet) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const parsed = parseA1Range(chart.sourceRange);
  if (!parsed) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const [from, to] = parsed;
  const width = to.c - from.c + 1;
  const height = to.r - from.r + 1;
  if (width < 2 || height < 2) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const columnSelection = resolveChartColumns(root, chart);
  if (columnSelection.seriesColumns.length === 0) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  // No X-axis column: categories are row positions (1, 2, 3 …).
  const xAxisIndex = columnSelection.xAxisColumn
    ? toColumnIndex(columnSelection.xAxisColumn)
    : null;
  if (columnSelection.xAxisColumn && !xAxisIndex) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }
  const { headerRow } = detectChartSourceLayout(sourceSheet, parsed);
  const firstDataRow = headerRow ? from.r + 1 : from.r;

  const series: ChartSeries[] = [];
  const config: Record<string, { label: string; color: string }> = {};
  const resolvedSeries: Array<ChartSeries & { index: number }> = [];

  for (const [index, column] of columnSelection.seriesColumns.entries()) {
    const colIndex = toColumnIndex(column);
    if (!colIndex) {
      continue;
    }

    const label = getColumnLabel(sourceSheet, from.r, colIndex, headerRow);
    const key = `series_${column}`;
    const chartSeries: ChartSeries = { key, label };
    series.push(chartSeries);
    resolvedSeries.push({ ...chartSeries, index: colIndex });
    config[key] = {
      label,
      color: getSeriesColor(index, palette),
    };
  }

  if (resolvedSeries.length === 0) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const xKey = "category";
  const rows: Array<Record<string, string | number>> = [];
  for (let r = firstDataRow; r <= to.r; r++) {
    const position = r - firstDataRow + 1;
    const row: Record<string, string | number> = {};
    row[xKey] = xAxisIndex
      ? getCellDisplayValue(sourceSheet, r, xAxisIndex) || `Row ${position}`
      : position;

    let hasNumericSeries = false;
    for (const seriesInfo of resolvedSeries) {
      const numeric = toNumeric(
        getCellRawValue(sourceSheet, r, seriesInfo.index),
      );
      if (numeric !== null) {
        row[seriesInfo.key] = numeric;
        hasNumericSeries = true;
      }
    }

    if (hasNumericSeries) {
      rows.push(row);
    }
  }

  const valueFormat = getValueFormat(
    sourceSheet,
    firstDataRow,
    to.r,
    resolvedSeries[0].index,
  );
  return valueFormat
    ? { xKey, rows, series, config, valueFormat }
    : { xKey, rows, series, config };
}

/**
 * Builds pie chart dataset.
 */
export function buildPieDataset(
  root: SpreadsheetDocument,
  chart: Pick<
    SheetChart,
    "sourceTabId" | "sourceRange" | "xAxisColumn" | "seriesColumns"
  >,
  palette?: string,
): PieDataset {
  const sourceSheet = root.sheets[chart.sourceTabId];
  if (!sourceSheet) {
    return { entries: [] };
  }

  const parsed = parseA1Range(chart.sourceRange);
  if (!parsed) {
    return { entries: [] };
  }

  const to = parsed[1];
  const selection = resolveChartColumns(root, chart);
  const labelColIndex = selection.xAxisColumn
    ? toColumnIndex(selection.xAxisColumn)
    : null;
  const valueColIndex = toColumnIndex(selection.seriesColumns[0] ?? "");

  if (valueColIndex === null || (selection.xAxisColumn && !labelColIndex)) {
    return { entries: [] };
  }

  const { headerRow } = detectChartSourceLayout(sourceSheet, parsed);
  const firstDataRow = headerRow ? parsed[0].r + 1 : parsed[0].r;
  const entries: PieDatasetEntry[] = [];
  for (let r = firstDataRow; r <= to.r; r++) {
    const label = labelColIndex
      ? getCellDisplayValue(sourceSheet, r, labelColIndex)
      : "";
    const numeric = toNumeric(
      getCellRawValue(sourceSheet, r, valueColIndex),
    );

    if (numeric === null || numeric <= 0) {
      continue;
    }

    entries.push({
      name: label || `Row ${r - firstDataRow + 1}`,
      value: numeric,
      color: getSeriesColor(entries.length, palette),
    });
  }

  return { entries };
}

/**
 * The name a column goes by in the legend and the editor's pickers: its
 * header cell, kept raw so a numeric-looking header in a formatted column
 * is not reformatted, or "Column C" when the range has no header row (a data
 * value is never presented as a header).
 */
function getColumnLabel(
  sheet: ChartSourceSheet,
  headerRow: number,
  col: number,
  hasHeaderRow: boolean,
): string {
  const header = hasHeaderRow ? getCellRawValue(sheet, headerRow, col) : "";
  return header || `Column ${toColumnName(col)}`;
}

/** Number formats the value axis repeats from its source cells. */
const AXIS_FORMATS = new Set(["currency", "percent"]);

/**
 * `getValueFormat` reads the effective number format of the first numeric
 * cell of a series column, so a currency column's axis ticks as currency.
 */
function getValueFormat(
  sheet: ChartSourceSheet,
  fromRow: number,
  toRow: number,
  col: number,
): ChartValueFormat | undefined {
  for (let r = fromRow; r <= toRow; r++) {
    const cell = getWorksheetCell(sheet, { r, c: col });
    if (toNumeric(getCellRawValue(sheet, r, col)) === null) continue;
    const style = resolveWorksheetCellStyle(sheet, { r, c: col }, cell?.s);
    if (!style?.nf || !AXIS_FORMATS.has(style.nf)) return undefined;
    // A percent preset merges onto the style without clearing `cu`, so a
    // column switched from currency to percent still carries one; only a
    // currency format may hand its currency to the axis.
    return style.nf === "currency" || style.nf === "accounting"
      ? { nf: style.nf, dp: style.dp, cu: style.cu }
      : { nf: style.nf, dp: style.dp };
  }
  return undefined;
}

/**
 * Returns the raw stored cell value as a string. Use this for values fed into
 * `toNumeric` (series data), which must stay numeric-parseable — a formatted
 * string like "$300.00" or "1,234" would break parsing in unexpected ways.
 */
function getCellRawValue(
  sheet: ChartSourceSheet,
  row: number,
  col: number,
): string {
  const value = getWorksheetCell(sheet, { r: row, c: col })?.v;
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

/**
 * Returns the formatted display value of a cell, applying the resolved
 * effective number/date format (sheet/col/row/range/cell layers). Use this for
 * data labels — axis/category values and pie slice names — so a date column
 * with a Locale Date format shows the formatted date rather than the raw value.
 * Non-numeric values (e.g. text labels) pass through `formatValue` unchanged.
 * (Header cells — series/column titles — use `getCellRawValue` instead.)
 */
function getCellDisplayValue(
  sheet: ChartSourceSheet,
  row: number,
  col: number,
): string {
  const cell = getWorksheetCell(sheet, { r: row, c: col });
  const value = cell?.v;
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const raw = typeof value === "string" ? value : String(value);
  const style = resolveWorksheetCellStyle(sheet, { r: row, c: col }, cell?.s);
  return formatValue(raw, style?.nf, style?.dp, { currency: style?.cu });
}

function toNumeric(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toColumnName(col: number): string {
  return toSref({ r: 1, c: col }).replace(/[0-9]+$/, "");
}

function toColumnIndex(column: string): number | null {
  const normalized = normalizeColumnName(column);
  if (!normalized) {
    return null;
  }

  try {
    return parseRef(`${normalized}1`).c;
  } catch {
    return null;
  }
}

function normalizeColumnName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}
