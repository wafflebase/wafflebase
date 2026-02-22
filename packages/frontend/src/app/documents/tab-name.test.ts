import assert from "node:assert/strict";
import test from "node:test";
import type { TabMeta } from "../../types/worksheet.ts";
import {
  buildTabNameNormalizationPatches,
  getNextDefaultSheetName,
  getUniqueTabName,
  isTabNameTaken,
  normalizeTabName,
} from "./tab-name.ts";

function buildTabs(entries: Array<[string, string, TabMeta["type"]]>): Record<string, TabMeta> {
  const tabs: Record<string, TabMeta> = {};
  for (const [id, name, type] of entries) {
    tabs[id] = { id, name, type };
  }
  return tabs;
}

test("normalizeTabName trims surrounding whitespace", () => {
  assert.equal(normalizeTabName("  Sheet1  "), "Sheet1");
});

test("isTabNameTaken checks names case-insensitively", () => {
  const tabs = buildTabs([
    ["tab-1", "Sheet1", "sheet"],
    ["tab-2", "DataSource", "datasource"],
  ]);

  assert.equal(isTabNameTaken(tabs, "sheet1"), true);
  assert.equal(isTabNameTaken(tabs, "SHEET1", "tab-1"), false);
  assert.equal(isTabNameTaken(tabs, "unknown"), false);
});

test("getUniqueTabName appends a numeric suffix when needed", () => {
  const tabs = buildTabs([
    ["tab-1", "Sheet1", "sheet"],
    ["tab-2", "Sheet1 (2)", "sheet"],
  ]);

  assert.equal(getUniqueTabName(tabs, "Sheet1", "Sheet"), "Sheet1 (3)");
  assert.equal(getUniqueTabName(tabs, "  ", "DataSource"), "DataSource");
});

test("getNextDefaultSheetName finds the lowest available SheetN name", () => {
  const tabs = buildTabs([
    ["tab-1", "Sheet1", "sheet"],
    ["tab-2", "Sheet3", "sheet"],
    ["tab-3", "SHEET2", "sheet"],
  ]);

  assert.equal(getNextDefaultSheetName(tabs), "Sheet4");
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

  assert.deepEqual(patches, [
    { tabId: "tab-1", name: "Sheet1" },
    { tabId: "tab-2", name: "sheet1 (2)" },
    { tabId: "tab-3", name: "DataSource" },
  ]);
});
