import { describe, expect, it } from "vitest";

import {
  resolveSheetChatAnchor,
  sheetAnchorSelectionType,
  sheetChatAnchor,
  sheetSendToChatAnchor,
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
  ) =>
    sheetChatAnchor({
      tabId: "t1",
      tabName: "Sheet1",
      range,
      selectionType,
      rowOrder,
      colOrder,
    })!;

  it("carries whole rows and whole columns in the anchor's kind", () => {
    const rows = anchorFor([{ r: 2, c: 1 }, { r: 4, c: 5 }], "row");
    expect(rows.kind).toBe("row");
    // Through the wire and back.
    const decoded = decodeAnchor(encodeAnchor(rows), "sheet")!;
    expect(sheetAnchorSelectionType(decoded as typeof rows)).toBe("row");
    expect(
      sheetAnchorSelectionType(anchorFor([{ r: 1, c: 2 }, { r: 7, c: 3 }], "column")),
    ).toBe("column");
  });

  it("leaves a plain range without a kind, and reads it as cells", () => {
    const cells = anchorFor([{ r: 3, c: 3 }, { r: 7, c: 5 }], "cell");
    expect(cells).not.toHaveProperty("kind");
    expect(sheetAnchorSelectionType(cells)).toBe("cell");
  });

  it("restores a whole-tab share as its cell range", () => {
    const all = anchorFor([{ r: 1, c: 1 }, { r: 7, c: 5 }], "all");
    expect(all.kind).toBe("all");
    expect(sheetAnchorSelectionType(all)).toBe("cell");
  });

  it("does not read the selection kind off the label", () => {
    // The label is display text: it says rows, but nothing structured does.
    const cells = anchorFor([{ r: 2, c: 1 }, { r: 4, c: 5 }]);
    expect(sheetAnchorSelectionType({ ...cells, label: "Sheet1!2:4" })).toBe("cell");
  });
});

describe("sheetSendToChatAnchor", () => {
  // Two tabs whose axes differ, so reading the wrong tab — or rows for
  // columns — gives a different anchor.
  const root = {
    tabs: { t1: { name: "Sheet1" }, t2: { name: "Q4 plan" } },
    sheets: {
      t1: { rowOrder: ["a1", "a2"], colOrder: ["x1", "x2"] },
      t2: { rowOrder: ["r1", "r2", "r3"], colOrder: ["c1", "c2", "c3", "c4"] },
    },
  };
  const sheet = (
    range: [{ r: number; c: number }, { r: number; c: number }] | null,
    type?: "cell" | "row" | "column" | "all",
  ) => ({
    getSelectionRangeOrActiveCell: () => range,
    getSelectionType: () => type,
  });

  it("anchors the live selection on the current tab's own axes", () => {
    expect(
      sheetSendToChatAnchor(sheet([{ r: 2, c: 3 }, { r: 3, c: 4 }]), root, "t2"),
    ).toEqual({
      tabId: "t2",
      rowId: "r2",
      colId: "c3",
      rowSpan: 2,
      colSpan: 2,
      label: "'Q4 plan'!C2:D3",
    });
  });

  it("passes the selection type through", () => {
    expect(
      sheetSendToChatAnchor(sheet([{ r: 1, c: 1 }, { r: 2, c: 4 }], "row"), root, "t2"),
    ).toMatchObject({ kind: "row", label: "'Q4 plan'!1:2" });
  });

  it("sends document-level without a selection, a tab or an editor", () => {
    expect(sheetSendToChatAnchor(sheet(null), root, "t2")).toBeNull();
    expect(sheetSendToChatAnchor(sheet([{ r: 1, c: 1 }, { r: 1, c: 1 }]), root, "gone")).toBeNull();
    expect(sheetSendToChatAnchor(null, root, "t2")).toBeNull();
    expect(sheetSendToChatAnchor(sheet([{ r: 1, c: 1 }, { r: 1, c: 1 }]), undefined, "t2")).toBeNull();
  });
});
