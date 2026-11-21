import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorksheet,
  parseRef,
  writeWorksheetCell,
  type Worksheet,
} from "@wafflebase/sheets";
import { prepareSheetThumbnail, waitForRender } from "./sheet-thumbnail";

/** A worksheet holding `cells` (sref → value), built the way the engine builds one. */
function worksheet(
  cells: Record<string, { v: string }>,
  extra: Partial<Worksheet> = {},
): Worksheet {
  const ws = createWorksheet({ frozenRows: 1, ...extra });
  for (const [sref, cell] of Object.entries(cells)) {
    writeWorksheetCell(ws, parseRef(sref), cell);
  }
  return ws;
}

describe("prepareSheetThumbnail", () => {
  it("finds the last row and column that hold a value", () => {
    const out = prepareSheetThumbnail(worksheet({ A1: { v: "x" }, C4: { v: "y" }, B2: { v: "z" } }));
    expect(out).toMatchObject({ lastRow: 4, lastCol: 3 });
  });

  it("extends the range to cover a merge that ends past the last value", () => {
    const out = prepareSheetThumbnail(
      worksheet({ A1: { v: "x" } }, { merges: { B2: { rs: 3, cs: 4 } } } as Partial<Worksheet>),
    );
    // B2 spanning 3 rows and 4 columns ends at E4.
    expect(out).toMatchObject({ lastRow: 4, lastCol: 5 });
  });

  it("returns null for an empty sheet", () => {
    expect(prepareSheetThumbnail(worksheet({}))).toBeNull();
    expect(prepareSheetThumbnail(undefined)).toBeNull();
  });

  it("drops the freeze pane from the copy it paints", () => {
    const out = prepareSheetThumbnail(worksheet({ A1: { v: "x" } }, { frozenRows: 1, frozenCols: 2 }));
    expect(out?.worksheet.frozenRows).toBe(0);
    expect(out?.worksheet.frozenCols).toBe(0);
  });

  it("unwraps a proxy through toJSON and never hands out the live object", () => {
    const live = worksheet({ A1: { v: "x" }, B2: { v: "y" } });
    // Yorkie's proxies serialise themselves to a JSON string.
    const proxy = { toJSON: () => JSON.stringify(live) };
    const out = prepareSheetThumbnail(proxy);
    expect(out).toMatchObject({ lastRow: 2, lastCol: 2 });
    const copied = Object.values(out!.worksheet.cells ?? {})[0] as { v: string };
    copied.v = "changed";
    expect(Object.values(live.cells ?? {}).map((c) => (c as { v: string }).v)).toEqual(["x", "y"]);
  });
});

describe("waitForRender", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A stand-in for `Spreadsheet.onSelectionChange`. */
  function engine() {
    const listeners = new Set<() => void>();
    return {
      listeners,
      subscribe: (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      finishRender: () => [...listeners].forEach((cb) => cb()),
    };
  }

  it("resolves true when the engine reports a completed render", async () => {
    const e = engine();
    const done = waitForRender(e.subscribe, 3000);
    e.finishRender();
    await expect(done).resolves.toBe(true);
    expect(e.listeners.size).toBe(0);
  });

  it("resolves false when no render completes (a hidden tab), and unsubscribes", async () => {
    const e = engine();
    const done = waitForRender(e.subscribe, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toBe(false);
    expect(e.listeners.size).toBe(0);
    // A late render does not flip the answer.
    e.finishRender();
    await expect(done).resolves.toBe(false);
  });
});
