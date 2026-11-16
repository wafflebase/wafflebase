import { describe, expect, it } from "vitest";
import type { Range } from "@wafflebase/sheets";
import {
  formatA1Ranges,
  panelOpeningFor,
  parseA1Ranges,
  selectionToA1,
  type SelectionSource,
} from "./rule-panel-utils";

const B2E4: Range = [
  { r: 2, c: 2 },
  { r: 4, c: 5 },
];

describe("parseA1Ranges", () => {
  it("normalizes and round-trips ranges", () => {
    expect(parseA1Ranges("E4:B2")).toEqual([B2E4]);
    expect(formatA1Ranges(parseA1Ranges("$b$2:e4, A1:A1")!)).toBe(
      "B2:E4, A1:A1",
    );
  });

  it("rejects a malformed segment", () => {
    expect(parseA1Ranges("B2")).toBeNull();
    expect(parseA1Ranges("B2:E4, nope")).toBeNull();
    expect(parseA1Ranges("")).toBeNull();
  });
});

describe("panelOpeningFor", () => {
  it("drafts a rule for a selection no rule covers", () => {
    expect(panelOpeningFor([], "B2:E4")).toEqual({
      kind: "draft",
      ranges: [B2E4],
    });
    expect(
      panelOpeningFor(
        [{ id: "far", ranges: [[{ r: 10, c: 10 }, { r: 12, c: 12 }]] }],
        "B2:E4",
      ),
    ).toEqual({ kind: "draft", ranges: [B2E4] });
  });

  it("selects a rule that already covers part of the selection", () => {
    expect(
      panelOpeningFor(
        [
          { id: "far", ranges: [[{ r: 10, c: 10 }, { r: 12, c: 12 }]] },
          { id: "near", ranges: [[{ r: 3, c: 3 }, { r: 3, c: 3 }]] },
        ],
        "B2:E4",
      ),
    ).toEqual({ kind: "existing", ruleId: "near" });
  });

  it("opens on the list without a cell selection", () => {
    expect(panelOpeningFor([], null)).toEqual({ kind: "none" });
  });
});

describe("selectionToA1", () => {
  // Mirrors the Spreadsheet API after a plain click on C3: no drag range,
  // only an active cell.
  const clickedC3 = (): SelectionSource => ({
    getSelectionType: () => "cell",
    getSelectionRanges: () => [],
    getSelectionRangeOrActiveCell: () => [
      { r: 3, c: 3 },
      { r: 3, c: 3 },
    ],
  });

  it("falls back to the active cell when no drag range exists", () => {
    expect(selectionToA1(clickedC3())).toBe("C3:C3");
  });

  it("lets a panel draft a rule for a single selected cell", () => {
    expect(panelOpeningFor([], selectionToA1(clickedC3()))).toEqual({
      kind: "draft",
      ranges: [
        [
          { r: 3, c: 3 },
          { r: 3, c: 3 },
        ],
      ],
    });
  });

  it("formats every drag range when there are some", () => {
    expect(
      selectionToA1({
        ...clickedC3(),
        getSelectionRanges: () => [B2E4, [{ r: 1, c: 1 }, { r: 1, c: 1 }]],
      }),
    ).toBe("B2:E4, A1:A1");
  });

  it("reports no selection for a row, column or all selection", () => {
    expect(
      selectionToA1({ ...clickedC3(), getSelectionType: () => "row" }),
    ).toBeNull();
  });
});
