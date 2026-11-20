import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorksheet,
  parseRef,
  writeWorksheetCell,
  type Worksheet,
} from "@wafflebase/sheets";
import { prepareSheetThumbnail, waitForPaint } from "./sheet-thumbnail";

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

describe("waitForPaint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves after two animation frames", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    let settled = false;
    void waitForPaint(10_000).then(() => (settled = true));
    frames.shift()!(0);
    frames.shift()!(0);
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it("still resolves when frames never arrive (a hidden tab)", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    let settled = false;
    void waitForPaint(500).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
