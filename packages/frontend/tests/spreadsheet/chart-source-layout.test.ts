import { describe, expect, test } from "vitest";
import {
  createWorksheet,
  writeWorksheetCell,
  type CellStyle,
} from "@wafflebase/sheets";
import type { SpreadsheetDocument } from "@/types/worksheet";
import {
  NO_X_AXIS_COLUMN,
  buildChartDataset,
  buildPieDataset,
  computeNewChartPlacement,
  detectChartSourceLayout,
  getDefaultChartColumns,
  getDefaultChartTitle,
  parseA1Range,
  placeNewChart,
  resolveChartColumns,
} from "../../src/app/spreadsheet/chart-utils";
import { COLOR_PALETTES } from "../../src/app/spreadsheet/chart-colors";

/** Builds a one-tab document from `{ A1: "x", ... }`. */
function makeDoc(
  cells: Record<string, string>,
  colStyles?: Record<string, CellStyle>,
): SpreadsheetDocument {
  const ws = createWorksheet();
  for (const [sref, v] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(sref)!;
    const c = match[1].charCodeAt(0) - 64;
    writeWorksheetCell(ws, { r: Number(match[2]), c }, { v });
  }
  if (colStyles) ws.colStyles = colStyles;
  return {
    tabs: { "tab-1": { id: "tab-1", name: "Sheet1", type: "sheet" } },
    tabOrder: ["tab-1"],
    sheets: { "tab-1": ws },
  };
}

const layoutOf = (doc: SpreadsheetDocument, range: string) =>
  detectChartSourceLayout(doc.sheets["tab-1"], parseA1Range(range)!);

// The critique's case: B2:D4 holds numbers only.
const numericOnly = {
  B2: "1200",
  C2: "1250",
  D2: "1300",
  B3: "1400",
  C3: "1450",
  D3: "1500",
  B4: "1600",
  C4: "1650",
  D4: "1700",
};

const table = {
  A1: "Month",
  B1: "Revenue",
  C1: "Cost",
  A2: "Jan",
  B2: "100",
  C2: "60",
  A3: "Feb",
  B3: "120",
  C3: "70",
};

describe("detectChartSourceLayout", () => {
  test("a numbers-only range has neither a header row nor a label column", () => {
    expect(layoutOf(makeDoc(numericOnly), "B2:D4")).toEqual({
      headerRow: false,
      labelColumn: false,
    });
  });

  test("text over numbers is a header row; a text first column is labels", () => {
    expect(layoutOf(makeDoc(table), "A1:C3")).toEqual({
      headerRow: true,
      labelColumn: true,
    });
  });

  test("a numeric-looking header beside a text header is still a header", () => {
    const doc = makeDoc({
      A1: "Region",
      B1: "2025",
      C1: "Units",
      A2: "East",
      B2: "100",
      C2: "5",
      A3: "West",
      B3: "200",
      C3: "6",
    });
    expect(layoutOf(doc, "A1:C3").headerRow).toBe(true);
  });

  test("a header row makes a numeric first column (years) the labels", () => {
    const doc = makeDoc({
      A1: "Year",
      B1: "Sales",
      A2: "2024",
      B2: "10",
      A3: "2025",
      B3: "12",
    });
    expect(layoutOf(doc, "A1:B3")).toEqual({
      headerRow: true,
      labelColumn: true,
    });
  });

  test("text labels without a header row keep the first row as data", () => {
    const doc = makeDoc({ A1: "East", B1: "100", A2: "West", B2: "200" });
    expect(layoutOf(doc, "A1:B2")).toEqual({
      headerRow: false,
      labelColumn: true,
    });
  });
});

describe("charts from a range without headers", () => {
  const chart = {
    sourceTabId: "tab-1",
    sourceRange: "B2:D4",
  };

  test("default columns put every column into a series", () => {
    const doc = makeDoc(numericOnly);
    const range = parseA1Range("B2:D4")!;
    expect(
      getDefaultChartColumns(range, layoutOf(doc, "B2:D4")),
    ).toEqual({ xAxisColumn: NO_X_AXIS_COLUMN, seriesColumns: ["B", "C", "D"] });
  });

  test("the first row is charted as data and series are named by column", () => {
    const doc = makeDoc(numericOnly);
    const dataset = buildChartDataset(doc, {
      ...chart,
      xAxisColumn: NO_X_AXIS_COLUMN,
      seriesColumns: ["B", "C", "D"],
    });
    expect(dataset.rows).toHaveLength(3);
    expect(dataset.rows[0]).toMatchObject({
      category: 1,
      series_B: 1200,
      series_C: 1250,
    });
    expect(dataset.series.map((s) => s.label)).toEqual([
      "Column B",
      "Column C",
      "Column D",
    ]);
  });

  test("an unset x-axis follows detection instead of claiming column B", () => {
    const doc = makeDoc(numericOnly);
    const selection = resolveChartColumns(doc, chart);
    expect(selection.xAxisColumn).toBeNull();
    expect(selection.seriesColumns).toEqual(["B", "C", "D"]);
    // The pickers show a column name, never a data value as a header.
    expect(selection.columns.map((c) => c.label)).toEqual([
      "Column B",
      "Column C",
      "Column D",
    ]);
  });

  test("an explicit x-axis column is still honored", () => {
    const doc = makeDoc(numericOnly);
    const dataset = buildChartDataset(doc, {
      ...chart,
      xAxisColumn: "B",
      seriesColumns: ["C"],
    });
    expect(dataset.rows[0]).toMatchObject({ category: "1200", series_C: 1250 });
    expect(dataset.rows).toHaveLength(3);
  });

  test("a pie without a label column names slices by row", () => {
    const doc = makeDoc(numericOnly);
    const pie = buildPieDataset(doc, {
      ...chart,
      xAxisColumn: NO_X_AXIS_COLUMN,
      seriesColumns: ["C"],
    });
    expect(pie.entries.map((e) => [e.name, e.value])).toEqual([
      ["Row 1", 1250],
      ["Row 2", 1450],
      ["Row 3", 1650],
    ]);
  });
});

describe("charts from a table with headers", () => {
  test("keeps the header row as series names", () => {
    const doc = makeDoc(table);
    const dataset = buildChartDataset(doc, {
      sourceTabId: "tab-1",
      sourceRange: "A1:C3",
      xAxisColumn: "A",
      seriesColumns: ["B", "C"],
    });
    expect(dataset.series.map((s) => s.label)).toEqual(["Revenue", "Cost"]);
    expect(dataset.rows.map((r) => r.category)).toEqual(["Jan", "Feb"]);
  });

  test("reports a currency source format for the value axis", () => {
    const doc = makeDoc(table, { "2": { nf: "currency", cu: "USD" } });
    const dataset = buildChartDataset(doc, {
      sourceTabId: "tab-1",
      sourceRange: "A1:C3",
      xAxisColumn: "A",
      seriesColumns: ["B"],
    });
    expect(dataset.valueFormat).toMatchObject({ nf: "currency", cu: "USD" });
  });

  test("a percent column drops a currency left over from a currency format", () => {
    const doc = makeDoc(table, { "2": { nf: "percent", cu: "USD" } });
    const dataset = buildChartDataset(doc, {
      sourceTabId: "tab-1",
      sourceRange: "A1:C3",
      xAxisColumn: "A",
      seriesColumns: ["B"],
    });
    expect(dataset.valueFormat).toEqual({ nf: "percent", dp: undefined });
  });

  test("a plain number column reports no value format", () => {
    const doc = makeDoc(table);
    const dataset = buildChartDataset(doc, {
      sourceTabId: "tab-1",
      sourceRange: "A1:C3",
      xAxisColumn: "A",
      seriesColumns: ["B"],
    });
    expect(dataset.valueFormat).toBeUndefined();
  });
});

describe("getDefaultChartTitle", () => {
  const base = { sourceTabId: "tab-1", sourceRange: "A1:C3", xAxisColumn: "A" };

  test("names a one-series chart after its series", () => {
    expect(
      getDefaultChartTitle(makeDoc(table), { ...base, seriesColumns: ["B"] }),
    ).toBe("Revenue");
  });

  test("joins two series and names the axis", () => {
    expect(
      getDefaultChartTitle(makeDoc(table), {
        ...base,
        seriesColumns: ["B", "C"],
      }),
    ).toBe("Revenue and Cost by Month");
  });

  test("falls back to Chart when the range has no headers", () => {
    expect(
      getDefaultChartTitle(makeDoc(numericOnly), {
        sourceTabId: "tab-1",
        sourceRange: "B2:D4",
      }),
    ).toBe("Chart");
  });
});

describe("placeNewChart", () => {
  const visible = { left: 0, top: 0, right: 1200, bottom: 800 };
  const size = { width: 420, height: 260 };

  test("places the chart to the right of the source range", () => {
    const source = { left: 100, top: 40, right: 400, bottom: 120 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed).toEqual({ side: "right", left: 408, top: 40 });
  });

  test("goes below the range when the right side has no room", () => {
    const source = { left: 100, top: 40, right: 1000, bottom: 120 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed).toEqual({ side: "below", left: 100, top: 128 });
  });

  test("pulls the chart up so it stays inside the visible area", () => {
    const source = { left: 100, top: 700, right: 400, bottom: 780 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed.side).toBe("right");
    expect(placed.top).toBe(800 - 260 - 8);
    // Never over the source columns.
    expect(placed.left).toBeGreaterThanOrEqual(400);
  });

  test("starts inside the viewport when the range begins above it", () => {
    const source = { left: 100, top: -500, right: 400, bottom: 300 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed).toEqual({ side: "right", left: 408, top: 8 });
  });

  test("starts inside the viewport when the range is scrolled out left", () => {
    const source = { left: -900, top: 40, right: -300, bottom: 120 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed).toEqual({ side: "right", left: 8, top: 40 });
  });

  test("starts below inside the viewport when the range is scrolled out above", () => {
    // Too wide to sit beside, and entirely above the visible area.
    const source = { left: 100, top: -600, right: 1000, bottom: -200 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed).toEqual({ side: "below", left: 100, top: 8 });
  });

  test("falls back to the right of the range when nothing fits", () => {
    const source = { left: 0, top: 0, right: 1100, bottom: 700 };
    const placed = placeNewChart({ source, visible, size, gap: 8 });
    expect(placed).toEqual({ side: "right", left: 1108, top: 8 });
  });
});

describe("computeNewChartPlacement", () => {
  // A uniform 100×20 grid at zoom 1, headers 50px / 20px, nothing scrolled.
  const geometry = {
    getZoom: () => 1,
    getCellRectInScrollableViewport: (ref: { r: number; c: number }) => ({
      left: 50 + (ref.c - 1) * 100,
      top: 20 + (ref.r - 1) * 20,
      width: 100,
      height: 20,
    }),
    getGridViewportRect: () => ({ left: 0, top: 0, width: 1250, height: 820 }),
    getScrollableGridViewportRect: () => ({
      left: 50,
      top: 20,
      width: 1200,
      height: 800,
    }),
  };

  test("anchors a chart beside B2:D4 instead of on top of it", () => {
    const placement = computeNewChartPlacement(
      geometry,
      parseA1Range("B2:D4")!,
      { width: 420, height: 260 },
    );
    // Column E is the first one right of the range; the chart starts a gap
    // past its left edge, level with the range's top row.
    expect(placement).toEqual({ anchor: "E2", offsetX: 8, offsetY: 0 });
  });

  test("anchors below a range too wide to sit beside", () => {
    const placement = computeNewChartPlacement(
      geometry,
      parseA1Range("A1:J3")!,
      { width: 420, height: 260 },
    );
    expect(placement.anchor).toBe("A4");
    expect(placement.offsetY).toBe(8);
  });
});

describe("default chart palette", () => {
  test("uses the categorical chart tokens, not tints of one accent", () => {
    expect(COLOR_PALETTES.default).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ]);
  });
});
