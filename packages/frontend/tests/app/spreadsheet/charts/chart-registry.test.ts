import { describe, it, expect } from 'vitest';
import {
  getChartEntry,
  getAllChartEntries,
} from "../../../../src/app/spreadsheet/charts/chart-registry.ts";

describe("chart-registry", () => {
  it("returns entry for bar", () => {
    const entry = getChartEntry("bar");
    expect(entry.label).toBe("Bar chart");
    expect(entry.category).toBe("cartesian");
  });

  it("returns entry for each type", () => {
    for (const type of ["bar", "line", "area", "pie", "scatter"] as const) {
      const entry = getChartEntry(type);
      expect(entry.type).toBe(type);
    }
  });

  it("pie has correct capabilities", () => {
    const entry = getChartEntry("pie");
    expect(entry.category).toBe("radial");
    expect(entry.editorCapabilities.multiSeries).toBe(false);
    expect(entry.editorCapabilities.gridlines).toBe(false);
  });

  it("getAllChartEntries returns all 5 types", () => {
    const entries = getAllChartEntries();
    const types = new Set(entries.map((e) => e.type));
    expect(types).toEqual(new Set(["bar", "line", "area", "pie", "scatter"]));
  });

  it("throws for unknown type", () => {
    expect(() => getChartEntry("unknown" as never)).toThrow();
  });

  it("bar has all editor capabilities enabled", () => {
    const entry = getChartEntry("bar");
    expect(entry.editorCapabilities.xAxis).toBe(true);
    expect(entry.editorCapabilities.series).toBe(true);
    expect(entry.editorCapabilities.multiSeries).toBe(true);
    expect(entry.editorCapabilities.gridlines).toBe(true);
    expect(entry.editorCapabilities.legendPosition).toBe(true);
  });

  it("scatter has correct category", () => {
    const entry = getChartEntry("scatter");
    expect(entry.category).toBe("scatter");
  });

  it("all chart types have renderers", () => {
    const entries = getAllChartEntries();
    for (const entry of entries) {
      expect(entry.renderer, `${entry.type} should have a renderer`).toBeTruthy();
    }
  });

  it("each entry has an icon component", () => {
    const entries = getAllChartEntries();
    for (const entry of entries) {
      expect(entry.icon, `${entry.type} should have an icon`).toBeTruthy();
    }
  });
});
