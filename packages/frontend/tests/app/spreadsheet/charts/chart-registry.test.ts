import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getChartEntry,
  getAllChartEntries,
} from "../../../../src/app/spreadsheet/charts/chart-registry.ts";

describe("chart-registry", () => {
  it("returns entry for bar", () => {
    const entry = getChartEntry("bar");
    assert.equal(entry.label, "Bar chart");
    assert.equal(entry.category, "cartesian");
  });

  it("returns entry for each type", () => {
    for (const type of ["bar", "line", "area", "pie", "scatter"] as const) {
      const entry = getChartEntry(type);
      assert.equal(entry.type, type);
    }
  });

  it("pie has correct capabilities", () => {
    const entry = getChartEntry("pie");
    assert.equal(entry.category, "radial");
    assert.equal(entry.editorCapabilities.multiSeries, false);
    assert.equal(entry.editorCapabilities.gridlines, false);
  });

  it("getAllChartEntries returns all 5 types", () => {
    const entries = getAllChartEntries();
    const types = new Set(entries.map((e) => e.type));
    assert.deepEqual(types, new Set(["bar", "line", "area", "pie", "scatter"]));
  });

  it("throws for unknown type", () => {
    assert.throws(() => getChartEntry("unknown" as never));
  });

  it("bar has all editor capabilities enabled", () => {
    const entry = getChartEntry("bar");
    assert.equal(entry.editorCapabilities.xAxis, true);
    assert.equal(entry.editorCapabilities.series, true);
    assert.equal(entry.editorCapabilities.multiSeries, true);
    assert.equal(entry.editorCapabilities.gridlines, true);
    assert.equal(entry.editorCapabilities.legendPosition, true);
  });

  it("scatter has correct category", () => {
    const entry = getChartEntry("scatter");
    assert.equal(entry.category, "scatter");
  });

  it("all chart types have renderers", () => {
    const entries = getAllChartEntries();
    for (const entry of entries) {
      assert.ok(entry.renderer, `${entry.type} should have a renderer`);
    }
  });

  it("each entry has an icon component", () => {
    const entries = getAllChartEntries();
    for (const entry of entries) {
      assert.ok(entry.icon, `${entry.type} should have an icon`);
    }
  });
});
