import { describe, it, expect, beforeEach } from "vitest";
import yorkie from "@yorkie-js/sdk";
import { createWorksheet } from "@wafflebase/sheets";
import { YorkieStore } from "./yorkie-store";
import type { SpreadsheetDocument } from "@/types/worksheet";
import type { UserPresence } from "@/types/users";

const TabA = "tab-1-aaa";
const TabB = "tab-2-bbb";

/**
 * A detached Yorkie document is enough: `doc.history` is entirely local, so
 * undo and the `local-change` event it publishes behave exactly as they do
 * on an attached one — and this is the layer where the operation paths the
 * selection is read from are actually produced.
 */
function createDoc() {
  const doc = new yorkie.Document<SpreadsheetDocument, UserPresence>("sheet-test");
  doc.update((root) => {
    root.tabs = {
      [TabA]: { id: TabA, name: "Sheet1", type: "sheet" },
      [TabB]: { id: TabB, name: "Sheet2", type: "sheet" },
    };
    root.tabOrder = [TabA, TabB];
    root.sheets = {
      [TabA]: createWorksheet(),
      [TabB]: createWorksheet(),
    };
  });
  // Seeding the document is not an edit anyone should be able to undo.
  doc.clearHistory();
  return doc;
}

describe("YorkieStore undo selection", () => {
  let doc: ReturnType<typeof createDoc>;
  let store: YorkieStore;

  beforeEach(() => {
    doc = createDoc();
    store = new YorkieStore(doc, TabA);
  });

  it("points at a cell whose value was overwritten in place", async () => {
    // The reported defect: the key set is identical either side of the undo,
    // so diffing document state found nothing and the selection stayed put.
    await store.set({ r: 2, c: 3 }, { v: "first" });
    await store.set({ r: 2, c: 3 }, { v: "second" });

    const result = await store.undo();

    expect(result.success).toBe(true);
    expect(await store.get({ r: 2, c: 3 })).toEqual({ v: "first" });
    expect(result.selection).toEqual({
      tabId: TabA,
      otherTab: false,
      selectionType: "cell",
      range: [
        { r: 2, c: 3 },
        { r: 2, c: 3 },
      ],
    });
  });

  it("points at a cell whose content was cleared", async () => {
    await store.set({ r: 1, c: 1 }, { v: "kept" });
    await store.delete({ r: 1, c: 1 });

    const result = await store.undo();

    expect(result.selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 1 },
    ]);
  });

  it("spans every cell a batch wrote", async () => {
    store.beginBatch();
    await store.set({ r: 1, c: 1 }, { v: "a" });
    await store.set({ r: 3, c: 4 }, { v: "b" });
    store.endBatch();

    const result = await store.undo();

    expect(result.selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 4 },
    ]);
  });

  it("selects the column a width change resized", async () => {
    await store.setDimensionSize("column", 2, 240);

    const result = await store.undo();

    expect(result.selection?.selectionType).toBe("column");
    expect(result.selection?.range?.[0].c).toBe(2);
    expect(result.selection?.range?.[1].c).toBe(2);
  });

  it("selects the rows an undone insert removed", async () => {
    // Reach row 4 first, so the axis is long enough for an insert to land in
    // its middle rather than extending it.
    await store.set({ r: 4, c: 1 }, { v: "bottom" });
    await store.shiftCells("row", 2, 2);

    const result = await store.undo();

    expect(result.selection?.selectionType).toBe("row");
    expect(result.selection?.range?.[0].r).toBe(2);
    expect(result.selection?.range?.[1].r).toBe(2);
  });

  it("selects the rows an undone delete brought back", async () => {
    await store.set({ r: 5, c: 1 }, { v: "bottom" });
    await store.shiftCells("row", 2, -2);

    const result = await store.undo();

    expect(result.selection?.selectionType).toBe("row");
    expect(result.selection?.range?.[0].r).toBe(2);
    expect(result.selection?.range?.[1].r).toBe(3);
  });

  it("selects the cell a plain write touched, not the axis it grew", async () => {
    // Writing into untouched space extends `rowOrder` / `colOrder` in the
    // same change, so every ordinary cell write carries an axis operation.
    // Selecting those rows instead of the cell is the trap here.
    const result = await (async () => {
      await store.set({ r: 6, c: 4 }, { v: "fresh" });
      return store.undo();
    })();

    expect(result.selection?.selectionType).toBe("cell");
    expect(result.selection?.range).toEqual([
      { r: 6, c: 4 },
      { r: 6, c: 4 },
    ]);
  });

  it("selects the range a style change covered", async () => {
    // `setRangeStyles` assigns the whole array, so the operation lands on the
    // worksheet object with `key: "rangeStyles"` rather than on the array —
    // a shape a hand-built snapshot test cannot produce, and the one every
    // style merge/compaction/replace path actually takes.
    await store.setRangeStyles([
      {
        range: [
          { r: 2, c: 2 },
          { r: 4, c: 5 },
        ],
        style: { bold: true },
      },
    ]);

    const result = await store.undo();

    expect(result.success).toBe(true);
    expect(result.selection?.selectionType).toBe("cell");
    expect(result.selection?.range).toEqual([
      { r: 2, c: 2 },
      { r: 4, c: 5 },
    ]);
  });

  it("selects the wider range when a style patch is replaced", async () => {
    await store.setRangeStyles([
      {
        range: [
          { r: 1, c: 1 },
          { r: 6, c: 2 },
        ],
        style: { bold: true },
      },
    ]);
    await store.setRangeStyles([
      {
        range: [
          { r: 1, c: 1 },
          { r: 3, c: 2 },
        ],
        style: { bold: true, italic: true },
      },
    ]);

    const result = await store.undo();

    // Rows 4-6 belong only to the patch the undo brought back.
    expect(result.selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 6, c: 2 },
    ]);
  });

  it("redo restores the selection the same way", async () => {
    await store.set({ r: 5, c: 2 }, { v: "x" });
    await store.undo();

    const result = await store.redo();

    expect(result.success).toBe(true);
    expect(result.selection?.range).toEqual([
      { r: 5, c: 2 },
      { r: 5, c: 2 },
    ]);
  });

  it("reports a step that landed in another tab", async () => {
    const other = new YorkieStore(doc, TabB);
    await other.set({ r: 4, c: 1 }, { v: "elsewhere" });

    // Undo is pressed while Sheet1 is open, but Yorkie's history is per
    // document — without the tab id this replays invisibly.
    const result = await store.undo();

    expect(result.selection?.tabId).toBe(TabB);
    expect(result.selection?.otherTab).toBe(true);
    expect(result.selection?.range).toEqual([
      { r: 4, c: 1 },
      { r: 4, c: 1 },
    ]);
  });

  it("reports failure with no selection when there is nothing to undo", async () => {
    expect(await store.undo()).toEqual({ success: false });
    expect(await store.redo()).toEqual({ success: false });
  });
});
