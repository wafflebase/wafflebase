import assert from "node:assert/strict";
import test from "node:test";
import { needsRecalc } from "../../../src/app/spreadsheet/remote-change-utils.ts";

// ---------------------------------------------------------------------------
// needsRecalc — paths that require cross-sheet formula recalculation
// ---------------------------------------------------------------------------

test("returns true when operations are undefined (conservative)", () => {
  assert.equal(needsRecalc(undefined), true);
});

test("returns true for cell data changes", () => {
  const ops = [{ path: "$.sheets.tab-1.cells.1.2" }];
  assert.equal(needsRecalc(ops), true);
});

test("returns true for merge changes", () => {
  const ops = [{ path: "$.sheets.tab-1.merges.0" }];
  assert.equal(needsRecalc(ops), true);
});

test("returns true for tab name changes", () => {
  const ops = [{ path: "$.tabs.tab-1.name" }];
  assert.equal(needsRecalc(ops), true);
});

test("returns true when cell change is mixed with style changes", () => {
  const ops = [
    { path: "$.sheets.tab-1.rangeStyles.0" },
    { path: "$.sheets.tab-1.cells.1.1" },
  ];
  assert.equal(needsRecalc(ops), true);
});

// ---------------------------------------------------------------------------
// needsRecalc — paths that only need reload + render (no recalc)
// ---------------------------------------------------------------------------

test("returns false for rangeStyles changes", () => {
  const ops = [{ path: "$.sheets.tab-1.rangeStyles.0" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for colStyles changes", () => {
  const ops = [{ path: "$.sheets.tab-1.colStyles.3" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for rowStyles changes", () => {
  const ops = [{ path: "$.sheets.tab-1.rowStyles.5" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for sheetStyle changes", () => {
  const ops = [{ path: "$.sheets.tab-1.sheetStyle" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for rowHeights changes", () => {
  const ops = [{ path: "$.sheets.tab-1.rowHeights.10" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for colWidths changes", () => {
  const ops = [{ path: "$.sheets.tab-1.colWidths.4" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for conditionalFormats changes", () => {
  const ops = [{ path: "$.sheets.tab-1.conditionalFormats.0" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for filter changes", () => {
  const ops = [{ path: "$.sheets.tab-1.filter" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for hiddenRows changes", () => {
  const ops = [{ path: "$.sheets.tab-1.hiddenRows.0" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for hiddenColumns changes", () => {
  const ops = [{ path: "$.sheets.tab-1.hiddenColumns.2" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for frozenRows changes", () => {
  const ops = [{ path: "$.sheets.tab-1.frozenRows" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for frozenCols changes", () => {
  const ops = [{ path: "$.sheets.tab-1.frozenCols" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for chart changes", () => {
  const ops = [{ path: "$.sheets.tab-1.charts.chart-1" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for rowOrder changes", () => {
  const ops = [{ path: "$.sheets.tab-1.rowOrder.0" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for colOrder changes", () => {
  const ops = [{ path: "$.sheets.tab-1.colOrder.0" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for tabOrder changes", () => {
  const ops = [{ path: "$.tabOrder.0" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for pivotTable changes", () => {
  const ops = [{ path: "$.sheets.tab-1.pivotTable" }];
  assert.equal(needsRecalc(ops), false);
});

test("returns false for empty operations array", () => {
  assert.equal(needsRecalc([]), false);
});

test("returns false when all ops have no path", () => {
  const ops = [{ path: undefined }, {}] as Array<{ path?: string }>;
  assert.equal(needsRecalc(ops), false);
});

test("returns false for multiple non-cell changes", () => {
  const ops = [
    { path: "$.sheets.tab-1.rangeStyles.0" },
    { path: "$.sheets.tab-1.colWidths.3" },
    { path: "$.sheets.tab-1.rowHeights.5" },
  ];
  assert.equal(needsRecalc(ops), false);
});
