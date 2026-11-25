import { describe, expect, it } from "vitest";

import {
  resolveSheetChatAnchor,
  sheetAnchorSelectionType,
  sheetChatAnchor,
  sheetTabRef,
} from "@/app/spreadsheet/chat-anchor";
import { decodeAnchor, encodeAnchor } from "@/components/chat/document-link";

const rowOrder = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
const colOrder = ["c1", "c2", "c3", "c4", "c5"];

describe("sheetTabRef", () => {
  it("quotes names a formula would quote", () => {
    expect(sheetTabRef("Sheet1")).toBe("Sheet1");
    expect(sheetTabRef("Q4 plan")).toBe("'Q4 plan'");
    expect(sheetTabRef("Bob's")).toBe("'Bob''s'");
  });
});

describe("sheetChatAnchor", () => {
  it("anchors the top-left cell by axis id, with spans and an A1 label", () => {
    // Drawn bottom-up, right-to-left: still C3:E7.
    const anchor = sheetChatAnchor({
      tabId: "t1",
      tabName: "Sheet1",
      range: [
        { r: 7, c: 5 },
        { r: 3, c: 3 },
      ],
      rowOrder,
      colOrder,
    });
    expect(anchor).toEqual({
      tabId: "t1",
      rowId: "r3",
      colId: "c3",
      rowSpan: 5,
      colSpan: 3,
      label: "Sheet1!C3:E7",
    });
    expect(decodeAnchor(encodeAnchor(anchor!), "sheet")).toEqual(anchor);
  });

  it("labels a single cell, whole rows and whole columns", () => {
    const one = { r: 2, c: 2 };
    const label = (range: [typeof one, typeof one], selectionType?: "row" | "column") =>
      sheetChatAnchor({ tabId: "t", tabName: "Q4 plan", range, selectionType, rowOrder, colOrder })!
        .label;
    expect(label([one, one])).toBe("'Q4 plan'!B2");
    expect(label([{ r: 2, c: 1 }, { r: 4, c: 5 }], "row")).toBe("'Q4 plan'!2:4");
    expect(label([{ r: 1, c: 2 }, { r: 7, c: 3 }], "column")).toBe("'Q4 plan'!B:C");
  });

  it("answers null when the top-left cell has no axis ids", () => {
    expect(
      sheetChatAnchor({
        tabId: "t",
        tabName: "Sheet1",
        range: [
          { r: 9, c: 1 },
          { r: 9, c: 1 },
        ],
        rowOrder,
        colOrder,
      }),
    ).toBeNull();
  });
});

describe("resolveSheetChatAnchor", () => {
  const anchor = { tabId: "t", rowId: "r3", colId: "c3", rowSpan: 2, colSpan: 3 };

  it("follows the anchor through rows inserted above it", () => {
    expect(resolveSheetChatAnchor(anchor, ["new", ...rowOrder], colOrder)).toEqual([
      { r: 4, c: 3 },
      { r: 5, c: 5 },
    ]);
  });

  it("answers null once its row or column is deleted", () => {
    expect(resolveSheetChatAnchor(anchor, rowOrder.filter((r) => r !== "r3"), colOrder)).toBeNull();
    expect(resolveSheetChatAnchor(anchor, rowOrder, colOrder.filter((c) => c !== "c3"))).toBeNull();
  });
});

describe("sheetAnchorSelectionType", () => {
  const anchorFor = (
    range: [{ r: number; c: number }, { r: number; c: number }],
    selectionType?: "cell" | "row" | "column" | "all",
    tabName = "Sheet1",
  ) =>
    sheetChatAnchor({
      tabId: "t1",
      tabName,
      range,
      selectionType,
      rowOrder,
      colOrder,
    })!;

  it("reads whole rows and whole columns back off the label", () => {
    expect(
      sheetAnchorSelectionType(anchorFor([{ r: 2, c: 1 }, { r: 4, c: 5 }], "row")),
    ).toBe("row");
    expect(
      sheetAnchorSelectionType(
        anchorFor([{ r: 1, c: 2 }, { r: 7, c: 3 }], "column", "Q4 plan"),
      ),
    ).toBe("column");
    expect(
      sheetAnchorSelectionType(anchorFor([{ r: 3, c: 3 }, { r: 7, c: 5 }])),
    ).toBe("cell");
  });

  it("falls back to a cell range when the label disagrees with the spans", () => {
    const anchor = anchorFor([{ r: 2, c: 1 }, { r: 4, c: 5 }], "row");
    expect(sheetAnchorSelectionType({ ...anchor, label: "Sheet1!2:9" })).toBe("cell");
    expect(sheetAnchorSelectionType({ ...anchor, label: "Sheet1!A:B" })).toBe("cell");
  });
});
