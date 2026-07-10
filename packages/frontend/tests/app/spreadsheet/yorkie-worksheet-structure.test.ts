import { test, expect } from 'vitest';
import {
  getWorksheetCell,
  parseRef,
  writeWorksheetCell,
  type Cell,
} from "@wafflebase/sheets";
import { createWorksheet } from "../../../src/types/worksheet.ts";
import {
  applyYorkieWorksheetMove,
  applyYorkieWorksheetShift,
} from "../../../src/app/spreadsheet/yorkie-worksheet-structure.ts";

function normalizeCell(cell: Cell): Cell | null {
  const normalized: Cell = {};

  if (cell.v !== undefined && cell.v !== "") {
    normalized.v = cell.v;
  }
  if (cell.f !== undefined && cell.f !== "") {
    normalized.f = cell.f;
  }
  if (cell.s && Object.keys(cell.s).length > 0) {
    normalized.s = cell.s;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

test("applyYorkieWorksheetShift shifts worksheet metadata and cells together", () => {
  const worksheet = createWorksheet();

  writeWorksheetCell(worksheet, parseRef("A2"), { v: "10" });
  writeWorksheetCell(worksheet, parseRef("B2"), { v: "20" });
  worksheet.rowHeights["2"] = 24;
  worksheet.rowStyles["2"] = { bg: "#ffeeaa" };
  worksheet.rangeStyles = [
    {
      range: [{ r: 2, c: 1 }, { r: 2, c: 2 }],
      style: { bg: "#eeeeee" },
    },
  ];
  worksheet.conditionalFormats = [
    {
      id: "cf-1",
      ranges: [[{ r: 2, c: 1 }, { r: 2, c: 1 }]],
      op: "greaterThan",
      value: "0",
      style: { bg: "#ff0000" },
    },
  ];
  worksheet.merges = { A2: { rs: 1, cs: 2 } };
  worksheet.charts = {
    chart1: {
      id: "chart1",
      type: "bar",
      sourceTabId: "tab-1",
      sourceRange: "A1:B4",
      anchor: "A2",
      offsetX: 0,
      offsetY: 0,
      width: 320,
      height: 180,
    },
  };
  worksheet.dataValidations = [
    {
      id: "dv-1",
      kind: "checkbox",
      ranges: [[{ r: 2, c: 1 }, { r: 2, c: 1 }]],
    },
  ];

  applyYorkieWorksheetShift({
    ws: worksheet,
    axis: "row",
    index: 2,
    count: 1,
    normalizeCell,
  });

  expect(getWorksheetCell(worksheet, parseRef("A2"))).toBe(undefined);
  expect(getWorksheetCell(worksheet, parseRef("A3"))).toEqual({ v: "10" });
  expect(getWorksheetCell(worksheet, parseRef("B3"))).toEqual({ v: "20" });
  expect(worksheet.rowHeights).toEqual({ "3": 24 });
  expect(worksheet.rowStyles).toEqual({ "3": { bg: "#ffeeaa" } });
  expect(worksheet.rangeStyles).toEqual([
    {
      range: [{ r: 3, c: 1 }, { r: 3, c: 2 }],
      style: { bg: "#eeeeee" },
    },
  ]);
  expect(worksheet.conditionalFormats).toEqual([
    {
      id: "cf-1",
      ranges: [[{ r: 3, c: 1 }, { r: 3, c: 1 }]],
      op: "greaterThan",
      value: "0",
      style: { bg: "#ff0000" },
    },
  ]);
  expect(worksheet.merges).toEqual({ A3: { rs: 1, cs: 2 } });
  expect(worksheet.charts?.chart1.anchor).toBe("A3");
  expect(worksheet.dataValidations).toEqual([
    {
      id: "dv-1",
      kind: "checkbox",
      ranges: [[{ r: 3, c: 1 }, { r: 3, c: 1 }]],
    },
  ]);
});

test("applyYorkieWorksheetMove remaps worksheet metadata and cells together", () => {
  const worksheet = createWorksheet();

  writeWorksheetCell(worksheet, parseRef("A1"), { v: "5" });
  writeWorksheetCell(worksheet, parseRef("B1"), { v: "7" });
  writeWorksheetCell(worksheet, parseRef("A2"), { v: "9" });
  worksheet.rowHeights["1"] = 30;
  worksheet.rowStyles["1"] = { bg: "#ccddee" };
  worksheet.rangeStyles = [
    {
      range: [{ r: 1, c: 1 }, { r: 1, c: 2 }],
      style: { bg: "#dddddd" },
    },
  ];
  worksheet.conditionalFormats = [
    {
      id: "cf-2",
      ranges: [[{ r: 1, c: 1 }, { r: 1, c: 1 }]],
      op: "greaterThan",
      value: "0",
      style: { bg: "#00ff00" },
    },
  ];
  worksheet.merges = { A1: { rs: 1, cs: 2 } };
  worksheet.charts = {
    chart1: {
      id: "chart1",
      type: "line",
      sourceTabId: "tab-1",
      sourceRange: "A1:B4",
      anchor: "A1",
      offsetX: 0,
      offsetY: 0,
      width: 320,
      height: 180,
    },
  };
  worksheet.dataValidations = [
    {
      id: "dv-2",
      kind: "checkbox",
      ranges: [[{ r: 1, c: 1 }, { r: 1, c: 1 }]],
    },
  ];

  applyYorkieWorksheetMove({
    ws: worksheet,
    axis: "row",
    srcIndex: 1,
    count: 1,
    dstIndex: 3,
    normalizeCell,
  });

  expect(getWorksheetCell(worksheet, parseRef("A1"))).toEqual({ v: "9" });
  expect(getWorksheetCell(worksheet, parseRef("A2"))).toEqual({ v: "5" });
  expect(getWorksheetCell(worksheet, parseRef("B2"))).toEqual({ v: "7" });
  expect(worksheet.rowHeights).toEqual({ "2": 30 });
  expect(worksheet.rowStyles).toEqual({ "2": { bg: "#ccddee" } });
  expect(worksheet.rangeStyles).toEqual([
    {
      range: [{ r: 2, c: 1 }, { r: 2, c: 2 }],
      style: { bg: "#dddddd" },
    },
  ]);
  expect(worksheet.conditionalFormats).toEqual([
    {
      id: "cf-2",
      ranges: [[{ r: 2, c: 1 }, { r: 2, c: 1 }]],
      op: "greaterThan",
      value: "0",
      style: { bg: "#00ff00" },
    },
  ]);
  expect(worksheet.merges).toEqual({ A2: { rs: 1, cs: 2 } });
  expect(worksheet.charts?.chart1.anchor).toBe("A2");
  expect(worksheet.dataValidations).toEqual([
    {
      id: "dv-2",
      kind: "checkbox",
      ranges: [[{ r: 2, c: 1 }, { r: 2, c: 1 }]],
    },
  ]);
});
