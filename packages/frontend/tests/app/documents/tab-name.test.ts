import { test, expect } from 'vitest';
import type { TabMeta } from "../../../src/types/worksheet.ts";
import {
  buildTabNameNormalizationPatches,
  getNextDefaultSheetName,
  getUniqueTabName,
  isTabNameTaken,
  normalizeTabName,
} from "../../../src/app/documents/tab-name.ts";

function buildTabs(entries: Array<[string, string, TabMeta["type"]]>): Record<string, TabMeta> {
  const tabs: Record<string, TabMeta> = {};
  for (const [id, name, type] of entries) {
    tabs[id] = { id, name, type };
  }
  return tabs;
}

test("normalizeTabName trims surrounding whitespace", () => {
  expect(normalizeTabName("  Sheet1  ")).toBe("Sheet1");
});

test("isTabNameTaken checks names case-insensitively", () => {
  const tabs = buildTabs([
    ["tab-1", "Sheet1", "sheet"],
    ["tab-2", "DataSource", "datasource"],
  ]);

  expect(isTabNameTaken(tabs, "sheet1")).toBe(true);
  expect(isTabNameTaken(tabs, "SHEET1", "tab-1")).toBe(false);
  expect(isTabNameTaken(tabs, "unknown")).toBe(false);
});

test("getUniqueTabName appends a numeric suffix when needed", () => {
  const tabs = buildTabs([
    ["tab-1", "Sheet1", "sheet"],
    ["tab-2", "Sheet1 (2)", "sheet"],
  ]);

  expect(getUniqueTabName(tabs, "Sheet1", "Sheet")).toBe("Sheet1 (3)");
  expect(getUniqueTabName(tabs, "  ", "DataSource")).toBe("DataSource");
});

test("getNextDefaultSheetName finds the lowest available SheetN name", () => {
  const tabs = buildTabs([
    ["tab-1", "Sheet1", "sheet"],
    ["tab-2", "Sheet3", "sheet"],
    ["tab-3", "SHEET2", "sheet"],
  ]);

  expect(getNextDefaultSheetName(tabs)).toBe("Sheet4");
});

test("buildTabNameNormalizationPatches normalizes blanks and duplicates", () => {
  const tabs = buildTabs([
    ["tab-1", " Sheet1 ", "sheet"],
    ["tab-2", "sheet1", "sheet"],
    ["tab-3", "  ", "datasource"],
  ]);

  const patches = buildTabNameNormalizationPatches(
    ["tab-1", "tab-2", "tab-3"],
    tabs,
  );

  expect(patches).toEqual([
    { tabId: "tab-1", name: "Sheet1" },
    { tabId: "tab-2", name: "sheet1 (2)" },
    { tabId: "tab-3", name: "DataSource" },
  ]);
});
