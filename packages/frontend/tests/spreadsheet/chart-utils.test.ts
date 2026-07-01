import { describe, expect, test } from "vitest";
import {
  createWorksheet,
  formatValue,
  writeWorksheetCell,
  type Cell,
  type CellStyle,
} from "@wafflebase/sheets";
import type { SpreadsheetDocument } from "@/types/worksheet";
import {
  buildChartDataset,
  buildPieDataset,
} from "../../src/app/spreadsheet/chart-utils";

function makeDoc(
  cells: Array<[{ r: number; c: number }, Cell]>,
  colStyles?: Record<string, CellStyle>,
): SpreadsheetDocument {
  const ws = createWorksheet();
  for (const [ref, cell] of cells) {
    writeWorksheetCell(ws, ref, cell);
  }
  if (colStyles) {
    ws.colStyles = colStyles;
  }
  return {
    tabs: { "tab-1": { id: "tab-1", name: "Sheet1", type: "sheet" } },
    tabOrder: ["tab-1"],
    sheets: { "tab-1": ws },
  };
}

const chart = {
  sourceTabId: "tab-1",
  sourceRange: "A1:B3",
  xAxisColumn: "A",
  seriesColumns: ["B"],
};

describe("chart category/label formatting", () => {
  test("category labels inherit the source column number format", () => {
    const doc = makeDoc(
      [
        [{ r: 1, c: 1 }, { v: "Score" }],
        [{ r: 2, c: 1 }, { v: "100" }],
        [{ r: 3, c: 1 }, { v: "200" }],
        [{ r: 1, c: 2 }, { v: "Count" }],
        [{ r: 2, c: 2 }, { v: "10" }],
        [{ r: 3, c: 2 }, { v: "20" }],
      ],
      { "1": { nf: "number", dp: 2 } },
    );
    const dataset = buildChartDataset(doc, chart);
    // Label column A is number-formatted → "100.00", not the raw "100".
    expect(dataset.rows[0].category).toBe("100.00");
    expect(dataset.rows[1].category).toBe("200.00");
    // Series values remain numeric.
    expect(dataset.rows[0].series_B).toBe(10);
  });

  test("category labels inherit a date format via column style", () => {
    const doc = makeDoc(
      [
        [{ r: 1, c: 1 }, { v: "Date" }],
        [{ r: 2, c: 1 }, { v: "2026-07-01" }],
        [{ r: 3, c: 1 }, { v: "2026-07-02" }],
        [{ r: 1, c: 2 }, { v: "Count" }],
        [{ r: 2, c: 2 }, { v: "5" }],
        [{ r: 3, c: 2 }, { v: "8" }],
      ],
      { "1": { nf: "date" } },
    );
    const dataset = buildChartDataset(doc, chart);
    // Delegates to formatValue with the resolved date format.
    expect(dataset.rows[0].category).toBe(
      formatValue("2026-07-01", "date"),
    );
    expect(dataset.rows[0].series_B).toBe(5);
  });

  test("series values stay numeric when the value column is formatted", () => {
    // Regression: a currency-formatted VALUE column must not be run through
    // formatValue, or "$100.00" would fail numeric parsing and drop the row.
    const doc = makeDoc(
      [
        [{ r: 1, c: 1 }, { v: "Region" }],
        [{ r: 2, c: 1 }, { v: "East" }],
        [{ r: 3, c: 1 }, { v: "West" }],
        [{ r: 1, c: 2 }, { v: "Revenue" }],
        [{ r: 2, c: 2 }, { v: "100" }],
        [{ r: 3, c: 2 }, { v: "200" }],
      ],
      { "2": { nf: "currency", cu: "USD" } },
    );
    const dataset = buildChartDataset(doc, chart);
    expect(dataset.rows).toHaveLength(2);
    expect(dataset.rows[0]).toMatchObject({ category: "East", series_B: 100 });
    expect(dataset.rows[1]).toMatchObject({ category: "West", series_B: 200 });
  });

  test("series/header titles stay raw even in a formatted column", () => {
    // A numeric-looking header in a number-formatted column must NOT be
    // reformatted — it's an identifier, not a data label.
    const doc = makeDoc(
      [
        [{ r: 1, c: 1 }, { v: "Region" }],
        [{ r: 2, c: 1 }, { v: "East" }],
        [{ r: 3, c: 1 }, { v: "West" }],
        [{ r: 1, c: 2 }, { v: "2025" }],
        [{ r: 2, c: 2 }, { v: "100" }],
        [{ r: 3, c: 2 }, { v: "200" }],
      ],
      { "2": { nf: "number", dp: 2 } },
    );
    const dataset = buildChartDataset(doc, chart);
    // Series label is the raw header "2025", not "2,025.00".
    expect(dataset.series[0].label).toBe("2025");
    // But the numeric values are still charted.
    expect(dataset.rows[0].series_B).toBe(100);
  });

  test("pie labels are formatted while values stay numeric", () => {
    const doc = makeDoc(
      [
        [{ r: 1, c: 1 }, { v: "Date" }],
        [{ r: 2, c: 1 }, { v: "2026-07-01" }],
        [{ r: 3, c: 1 }, { v: "2026-07-02" }],
        [{ r: 1, c: 2 }, { v: "Count" }],
        [{ r: 2, c: 2 }, { v: "5" }],
        [{ r: 3, c: 2 }, { v: "8" }],
      ],
      { "1": { nf: "date" } },
    );
    const pie = buildPieDataset(doc, chart);
    expect(pie.entries).toHaveLength(2);
    expect(pie.entries[0]).toMatchObject({
      name: formatValue("2026-07-01", "date"),
      value: 5,
    });
  });
});
