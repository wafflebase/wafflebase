import { describe, expect, it, vi } from "vitest";
import type { Element } from "@wafflebase/slides";
import { buildStickyInit } from "./sticky";
import {
  colorKey,
  idsOfSameColor,
  idsOfSameType,
  selectSimilarMenuItems,
  similarityType,
} from "./board-select-similar";

const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
const sticky = (id: string, color: string) =>
  ({ ...buildStickyInit(color, { x: 0, y: 0 }), id }) as Element;
const shape = (id: string, kind: string, fill?: string) =>
  ({
    id,
    type: "shape",
    frame,
    data: { kind, ...(fill ? { fill: { kind: "srgb", value: fill } } : {}) },
  }) as unknown as Element;
const connector = (id: string, color: string) =>
  ({
    id,
    type: "connector",
    frame,
    stroke: { color: { kind: "srgb", value: color }, width: 2 },
  }) as unknown as Element;

const elements: Element[] = [
  sticky("s1", "#FFF8B8"),
  sticky("s2", "#CDEFC4"),
  sticky("s3", "#fff8b8"),
  shape("r1", "rect", "#FFF8B8"),
  shape("e1", "ellipse", "#E3ECFA"),
  shape("e2", "ellipse"),
  shape("rr", "roundRect", "#E3ECFA"),
  connector("c1", "#FFF8B8"),
];

describe("similarityType", () => {
  it("tells a sticky from a plain rounded rectangle", () => {
    expect(similarityType(elements[0])).toBe("sticky");
    expect(similarityType(elements[6])).toBe("shape:roundRect");
    expect(similarityType(elements[4])).toBe("shape:ellipse");
    expect(similarityType(elements[7])).toBe("connector");
  });
});

describe("colorKey", () => {
  it("matches hex case-insensitively, and has no key for an unfilled shape", () => {
    expect(colorKey(elements[0])).toBe(colorKey(elements[2]));
    expect(colorKey(elements[5])).toBeNull();
  });
});

describe("idsOfSameType / idsOfSameColor", () => {
  it("selects every ellipse, not every shape", () => {
    expect(idsOfSameType(elements, elements[4])).toEqual(["e1", "e2"]);
  });

  it("selects across element types by colour (sticky, shape, connector)", () => {
    expect(idsOfSameColor(elements, elements[0])).toEqual(["s1", "s3", "r1", "c1"]);
  });
});

describe("selectSimilarMenuItems", () => {
  it("offers colour + stickies on a sticky, without a redundant type entry", () => {
    const select = vi.fn();
    const items = selectSimilarMenuItems(
      elements,
      { elementId: "s2", selectedIds: ["s2"] },
      select,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(["---", "Select all with same colour", "Select all stickies"]);
    items[2].run();
    expect(select).toHaveBeenCalledWith(["s1", "s2", "s3"]);
  });

  it("adds 'of this type' on a shape and disables colour with no colour", () => {
    const select = vi.fn();
    const items = selectSimilarMenuItems(
      elements,
      { elementId: "e2", selectedIds: ["e2"] },
      select,
    );
    expect(items.find((i) => i.label === "Select all with same colour")?.disabled).toBe(true);
    items.find((i) => i.label === "Select all of this type")!.run();
    expect(select).toHaveBeenCalledWith(["e1", "e2"]);
  });

  it("falls back to the selection when the hit is a group member", () => {
    const items = selectSimilarMenuItems(
      elements,
      { elementId: "nested-child", selectedIds: ["r1"] },
      vi.fn(),
    );
    expect(items.length).toBeGreaterThan(0);
    expect(
      selectSimilarMenuItems(elements, { elementId: "x", selectedIds: ["y"] }, vi.fn()),
    ).toEqual([]);
  });
});
