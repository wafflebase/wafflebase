import { parseRef, toSref } from "@wafflebase/sheet";
import { SheetChart, SpreadsheetDocument } from "@/types/worksheet";

type ParsedRange = readonly [
  { r: number; c: number },
  { r: number; c: number },
];

type ChartSourceSheet = SpreadsheetDocument["sheets"][string];

export type ChartSeries = {
  key: string;
  label: string;
};

export type ChartDataset = {
  xKey: string;
  rows: Array<Record<string, string | number>>;
  series: ChartSeries[];
  config: Record<string, { label: string; color: string }>;
};

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
 * Returns default chart columns.
 */
export function getDefaultChartColumns(range: ParsedRange): {
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

  return {
    xAxisColumn: columns[0],
    seriesColumns: columns.slice(1),
  };
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
  const columns: ChartColumnOption[] = [];
  for (let c = from.c; c <= to.c; c++) {
    const column = toColumnName(c);
    columns.push({
      column,
      index: c,
      label: getCellDisplayValue(sourceSheet, from.r, c) || column,
    });
  }

  if (columns.length === 0) {
    return { columns: [], xAxisColumn: null, seriesColumns: [] };
  }

  const defaultXAxis = columns[0].column;
  const requestedXAxis = normalizeColumnName(chart.xAxisColumn);
  const xAxisColumn = columns.some((column) => column.column === requestedXAxis)
    ? requestedXAxis
    : defaultXAxis;

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
  if (
    !columnSelection.xAxisColumn ||
    columnSelection.seriesColumns.length === 0
  ) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const xAxisIndex = toColumnIndex(columnSelection.xAxisColumn);
  if (!xAxisIndex) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const series: ChartSeries[] = [];
  const config: Record<string, { label: string; color: string }> = {};
  const resolvedSeries: Array<ChartSeries & { index: number }> = [];

  for (const [index, column] of columnSelection.seriesColumns.entries()) {
    const colIndex = toColumnIndex(column);
    if (!colIndex) {
      continue;
    }

    const label = getCellDisplayValue(sourceSheet, from.r, colIndex) || column;
    const key = `series_${column}`;
    const chartSeries: ChartSeries = { key, label };
    series.push(chartSeries);
    resolvedSeries.push({ ...chartSeries, index: colIndex });
    config[key] = {
      label,
      color: getSeriesThemeColor(index),
    };
  }

  if (resolvedSeries.length === 0) {
    return { xKey: "category", rows: [], series: [], config: {} };
  }

  const xKey = "category";
  const rows: Array<Record<string, string | number>> = [];
  for (let r = from.r + 1; r <= to.r; r++) {
    const row: Record<string, string | number> = {};
    row[xKey] =
      getCellDisplayValue(sourceSheet, r, xAxisIndex) || `Row ${r - from.r}`;

    let hasNumericSeries = false;
    for (const seriesInfo of resolvedSeries) {
      const numeric = toNumeric(
        getCellDisplayValue(sourceSheet, r, seriesInfo.index),
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

  return { xKey, rows, series, config };
}

function getCellDisplayValue(
  sheet: ChartSourceSheet,
  row: number,
  col: number,
): string {
  const value = sheet.sheet[toSref({ r: row, c: col })]?.v;
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
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

function getSeriesThemeColor(index: number): string {
  const palette = [
    "var(--color-primary)",
    "color-mix(in oklch, var(--color-primary) 78%, var(--color-background))",
    "color-mix(in oklch, var(--color-primary) 68%, var(--color-foreground))",
    "color-mix(in oklch, var(--color-primary) 56%, var(--color-background))",
    "color-mix(in oklch, var(--color-primary) 46%, var(--color-foreground))",
  ];

  return palette[index % palette.length];
}
