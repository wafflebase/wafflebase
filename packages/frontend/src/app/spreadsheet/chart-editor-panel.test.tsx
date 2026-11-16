import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createWorksheet, writeWorksheetCell } from "@wafflebase/sheets";
import type { SheetChart, SpreadsheetDocument } from "@/types/worksheet";
import { ChartEditorPanel } from "./chart-editor-panel";
import { NO_X_AXIS_COLUMN } from "./chart-utils";

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls when it
// opens its listbox.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

/** Builds a one-tab document from `{ A1: "x", ... }`. */
function makeDoc(cells: Record<string, string>): SpreadsheetDocument {
  const ws = createWorksheet();
  for (const [sref, v] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(sref)!;
    const c = match[1].charCodeAt(0) - 64;
    writeWorksheetCell(ws, { r: Number(match[2]), c }, { v });
  }
  return {
    tabs: { "tab-1": { id: "tab-1", name: "Sheet1", type: "sheet" } },
    tabOrder: ["tab-1"],
    sheets: { "tab-1": ws },
  };
}

// A header row over text labels: the first column labels the categories.
const labelled = makeDoc({
  A1: "Region",
  B1: "Sales",
  C1: "Cost",
  A2: "East",
  B2: "10",
  C2: "4",
  A3: "West",
  B3: "12",
  C3: "5",
});

// Numbers only, no header: every column is a series, no X-axis column.
const numericOnly = makeDoc({
  B2: "1",
  C2: "2",
  B3: "3",
  C3: "4",
});

function makeChart(patch: Partial<SheetChart>): SheetChart {
  return {
    id: "chart-1",
    type: "bar",
    sourceTabId: "tab-1",
    sourceRange: "A1:C3",
    anchor: "E1",
    offsetX: 0,
    offsetY: 0,
    width: 400,
    height: 300,
    ...patch,
  };
}

function renderPanel(root: SpreadsheetDocument, chart: SheetChart) {
  const onUpdateChart = vi.fn();
  render(
    <ChartEditorPanel
      root={root}
      chart={chart}
      open
      onClose={() => {}}
      onUpdateChart={onUpdateChart}
      getSelectionRange={() => null}
    />,
  );
  return { onUpdateChart, trigger: screen.getByRole("combobox", { name: "X-axis" }) };
}

/** Opens the X-axis picker and returns its option labels. */
function openXAxis(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("listbox");
}

function optionLabels(listbox: HTMLElement): string[] {
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

describe("ChartEditorPanel X-axis picker", () => {
  it("labels options with the header text, after a None option", () => {
    const { trigger } = renderPanel(labelled, makeChart({}));
    expect(optionLabels(openXAxis(trigger))).toEqual([
      "None",
      "Region",
      "Sales",
      "Cost",
    ]);
  });

  it("labels headerless columns by letter", () => {
    const { trigger } = renderPanel(
      numericOnly,
      makeChart({ sourceRange: "B2:C3" }),
    );
    expect(optionLabels(openXAxis(trigger))).toEqual([
      "None",
      "Column B",
      "Column C",
    ]);
  });

  it("shows the detected label column when the X-axis is unset", () => {
    const { trigger } = renderPanel(labelled, makeChart({}));
    expect(trigger).toHaveTextContent("Region");
  });

  it("shows None when detection finds no label column", () => {
    const { trigger } = renderPanel(
      numericOnly,
      makeChart({ sourceRange: "B2:C3" }),
    );
    expect(trigger).toHaveTextContent("None");
  });

  it("writes the empty-string sentinel when None is chosen", () => {
    const { trigger, onUpdateChart } = renderPanel(labelled, makeChart({}));
    fireEvent.click(
      within(openXAxis(trigger)).getByRole("option", { name: "None" }),
    );
    expect(onUpdateChart).toHaveBeenCalledWith("chart-1", {
      xAxisColumn: NO_X_AXIS_COLUMN,
      // The series already charted stay; A is not added back on its own.
      seriesColumns: ["B", "C"],
    });
  });

  it("writes the column letter when a column is chosen", () => {
    const { trigger, onUpdateChart } = renderPanel(labelled, makeChart({}));
    fireEvent.click(
      within(openXAxis(trigger)).getByRole("option", { name: "Sales" }),
    );
    expect(onUpdateChart).toHaveBeenCalledWith("chart-1", {
      xAxisColumn: "B",
      seriesColumns: ["C"],
    });
  });
});
