import { test, expect } from 'vitest';
import { parseRef, writeWorksheetCell } from "@wafflebase/sheets";
import {
  getSeriesColor,
  COLOR_PALETTES,
} from "../../../src/app/spreadsheet/chart-colors.ts";
import {
  buildPieDataset,
} from "../../../src/app/spreadsheet/chart-utils.ts";
import { createWorksheet } from "../../../src/types/worksheet.ts";

// ---------------------------------------------------------------------------
// getSeriesColor
// ---------------------------------------------------------------------------

test("getSeriesColor returns default palette colors when no palette specified", () => {
  const color = getSeriesColor(0);
  expect(color).toBe(COLOR_PALETTES.default[0]);
});

test("getSeriesColor returns named palette color", () => {
  const color = getSeriesColor(0, "warm");
  expect(color).toBe(COLOR_PALETTES.warm[0]);
});

test("getSeriesColor wraps around when index exceeds palette length", () => {
  const color = getSeriesColor(5);
  expect(color).toBe(COLOR_PALETTES.default[0]);
});

test("getSeriesColor falls back to default for unknown palette", () => {
  const color = getSeriesColor(0, "nonexistent");
  expect(color).toBe(COLOR_PALETTES.default[0]);
});

// ---------------------------------------------------------------------------
// buildPieDataset
// ---------------------------------------------------------------------------

/**
 * Helper: build a minimal SpreadsheetDocument with one tab and cell data.
 * `cells` maps sref keys (e.g. "A1") to cell values.
 */
function buildDoc(
  tabId: string,
  cells: Record<string, string | number>,
): Parameters<typeof buildPieDataset>[0] {
  const worksheet = createWorksheet();
  for (const [key, value] of Object.entries(cells)) {
    writeWorksheetCell(worksheet, parseRef(key), {
      v: typeof value === "number" ? String(value) : value,
    });
  }

  return {
    tabs: { [tabId]: { id: tabId, name: "Sheet1", type: "sheet" as const } },
    tabOrder: [tabId],
    sheets: {
      [tabId]: worksheet,
    },
  };
}

test("buildPieDataset builds pie entries from label and value columns", () => {
  // Range A1:B4 — row 1 is header, rows 2-4 are data
  const doc = buildDoc("tab1", {
    A1: "Category",
    B1: "Sales",
    A2: "Apples",
    B2: "100",
    A3: "Bananas",
    B3: "200",
    A4: "Cherries",
    B4: "300",
  });

  const result = buildPieDataset(doc, {
    sourceTabId: "tab1",
    sourceRange: "A1:B4",
    xAxisColumn: "A",
    seriesColumns: ["B"],
  });

  expect(result.entries.length).toBe(3);
  expect(result.entries[0].name).toBe("Apples");
  expect(result.entries[0].value).toBe(100);
  expect(result.entries[1].name).toBe("Bananas");
  expect(result.entries[1].value).toBe(200);
  expect(result.entries[2].name).toBe("Cherries");
  expect(result.entries[2].value).toBe(300);

  // Each entry should have a color from the default palette
  expect(result.entries[0].color).toBe(COLOR_PALETTES.default[0]);
  expect(result.entries[1].color).toBe(COLOR_PALETTES.default[1]);
  expect(result.entries[2].color).toBe(COLOR_PALETTES.default[2]);
});

test("buildPieDataset excludes non-positive values", () => {
  const doc = buildDoc("tab1", {
    A1: "Category",
    B1: "Value",
    A2: "Positive",
    B2: "50",
    A3: "Zero",
    B3: "0",
    A4: "Negative",
    B4: "-10",
    A5: "Another",
    B5: "75",
  });

  const result = buildPieDataset(doc, {
    sourceTabId: "tab1",
    sourceRange: "A1:B5",
    xAxisColumn: "A",
    seriesColumns: ["B"],
  });

  expect(result.entries.length).toBe(2);
  expect(result.entries[0].name).toBe("Positive");
  expect(result.entries[0].value).toBe(50);
  expect(result.entries[1].name).toBe("Another");
  expect(result.entries[1].value).toBe(75);
});

test("buildPieDataset returns empty entries for missing source tab", () => {
  const doc = buildDoc("tab1", {});

  const result = buildPieDataset(doc, {
    sourceTabId: "nonexistent",
    sourceRange: "A1:B4",
    xAxisColumn: "A",
    seriesColumns: ["B"],
  });

  expect(result).toEqual({ entries: [] });
});
