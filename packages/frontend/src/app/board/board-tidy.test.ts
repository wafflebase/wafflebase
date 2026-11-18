import { describe, expect, it, vi } from "vitest";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { rowBands, tidyLayout, tidyUpSelection, TIDY_GAP, type TidyItem } from "./board-tidy";

const item = (id: string, x: number, y: number, w = 100, h = 100): TidyItem => ({
  id,
  frame: { x, y, w, h },
});

describe("rowBands", () => {
  it("groups a staggered grid into rows, each read left to right", () => {
    const bands = rowBands([
      item("c", 300, 12),
      item("a", 0, 0),
      item("b", 140, 30),
      item("d", 10, 200),
      item("e", 180, 190),
    ]);
    expect(bands.map((r) => r.map((i) => i.id))).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("keeps a hand-placed 2x3 sticky grid with vertical jitter as two rows of three", () => {
    // 180px stickies, 24px apart, nudged up to 10px off the grid line.
    const s = (id: string, x: number, y: number) => item(id, x, y, 180, 180);
    const bands = rowBands([
      s("a", 0, 0),
      s("b", 204, 10),
      s("c", 408, -8),
      s("d", 4, 212),
      s("e", 206, 220),
      s("f", 410, 206),
    ]);
    expect(bands.map((r) => r.map((i) => i.id))).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    const layout = tidyLayout(bands.flat());
    expect(new Set([...layout.values()].map((p) => p.y)).size).toBe(2);
    expect(new Set([...layout.values()].map((p) => p.x)).size).toBe(3);
  });

  it("keeps two stickies that merely touch vertically in separate rows", () => {
    const bands = rowBands([item("a", 0, 0), item("b", 0, 90)]);
    expect(bands).toHaveLength(2);
  });
});

describe("tidyLayout", () => {
  it("is a no-op below two items", () => {
    expect(tidyLayout([item("a", 5, 5)]).size).toBe(0);
  });

  it("lays rows out on a uniform gap, anchored at the selection's top-left", () => {
    const layout = tidyLayout([
      item("a", 7, 3),
      item("b", 180, 40),
      item("c", 420, 0),
      item("d", 30, 260),
    ]);
    // Top-left anchor: min x = 7, min y = 0.
    expect(layout.get("a")).toEqual({ x: 7, y: 0 });
    expect(layout.get("b")).toEqual({ x: 7 + 100 + TIDY_GAP, y: 0 });
    expect(layout.get("c")).toEqual({ x: 7 + 2 * (100 + TIDY_GAP), y: 0 });
    // Second row, first column.
    expect(layout.get("d")).toEqual({ x: 7, y: 100 + TIDY_GAP });
  });

  it("sizes cells to the widest/tallest item and centres smaller ones", () => {
    const layout = tidyLayout([
      item("wide", 0, 0, 200, 100),
      item("small", 300, 0, 100, 50),
    ]);
    expect(layout.get("wide")).toEqual({ x: 0, y: 0 });
    // Row height 100 → the 50-tall item is centred: y = 25.
    expect(layout.get("small")).toEqual({ x: 200 + TIDY_GAP, y: 25 });
  });

  it("stacks a column of items vertically", () => {
    const layout = tidyLayout([item("a", 0, 0), item("b", 40, 400), item("c", 10, 150)]);
    expect(layout.get("a")).toEqual({ x: 0, y: 0 });
    expect(layout.get("c")).toEqual({ x: 0, y: 100 + TIDY_GAP });
    expect(layout.get("b")).toEqual({ x: 0, y: 2 * (100 + TIDY_GAP) });
  });
});

describe("tidyUpSelection", () => {
  function fakeStore(elements: unknown[]) {
    return {
      read: () => ({ slides: [{ elements }] }) as never,
      batch: vi.fn((fn: () => void) => fn()),
      updateElementFrame: vi.fn(),
    };
  }
  const shape = (id: string, x: number, y: number) => ({
    id,
    type: "shape",
    frame: { x, y, w: 100, h: 100, rotation: 0 },
    data: { kind: "rect" },
  });

  it("moves selected non-connectors in one batch, leaving connectors", () => {
    const store = fakeStore([
      shape("a", 0, 0),
      shape("b", 300, 10),
      { id: "c", type: "connector", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 } },
    ]);
    const editor = { getSelection: () => ["a", "b", "c"], isTextEditing: () => false };
    expect(tidyUpSelection(editor, store)).toBe(true);
    expect(store.batch).toHaveBeenCalledTimes(1);
    expect(store.updateElementFrame).toHaveBeenCalledTimes(1);
    expect(store.updateElementFrame).toHaveBeenCalledWith(SYNTHETIC_SLIDE_ID, "b", {
      x: 100 + TIDY_GAP,
      y: 0,
    });
  });

  it("does nothing while a text edit is live or when already tidy", () => {
    const store = fakeStore([shape("a", 0, 0), shape("b", 100 + TIDY_GAP, 0)]);
    expect(
      tidyUpSelection({ getSelection: () => ["a", "b"], isTextEditing: () => true }, store),
    ).toBe(false);
    expect(
      tidyUpSelection({ getSelection: () => ["a", "b"], isTextEditing: () => false }, store),
    ).toBe(false);
    expect(store.batch).not.toHaveBeenCalled();
  });
});
