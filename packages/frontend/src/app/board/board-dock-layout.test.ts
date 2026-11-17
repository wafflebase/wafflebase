import { describe, expect, it } from "vitest";
import {
  COLLAPSED_MINIMAP_CLEARANCE,
  DOCK_COMPACT_BELOW,
  DOCK_EDGE,
  MINIMAP_CLEARANCE,
  dockLayout,
} from "./board-dock-layout";
import { SHAPE_PICKER_CATEGORIES } from "../slides/shape-picker-helpers";
import { BOARD_SHAPES } from "./board-shapes";

describe("dockLayout", () => {
  it("keeps the wide default before the host is laid out", () => {
    expect(dockLayout(0, 0)).toMatchObject({ compact: false, align: "center" });
  });

  it("centres the dock when that clears the minimap's corner", () => {
    // 1280 host, 560 dock: 360px either side, more than the minimap needs.
    expect(dockLayout(1280, 560)).toMatchObject({ compact: false, align: "center" });
  });

  it("moves the dock bottom-left once centring would run into the minimap", () => {
    // 900 host, 560 dock: 170px either side, less than the 224 the minimap takes.
    expect(dockLayout(900, 560)).toEqual({
      compact: false,
      align: "start",
      maxWidth: `calc(100% - ${DOCK_EDGE + MINIMAP_CLEARANCE}px)`,
    });
  });

  it("goes compact below 640px and clears only the collapsed minimap toggle", () => {
    expect(dockLayout(DOCK_COMPACT_BELOW - 1, 240)).toEqual({
      compact: true,
      align: "start",
      maxWidth: `calc(100% - ${DOCK_EDGE + COLLAPSED_MINIMAP_CLEARANCE}px)`,
    });
    expect(dockLayout(DOCK_COMPACT_BELOW, 240).compact).toBe(false);
  });
});

describe("BOARD_SHAPES", () => {
  it("is about a dozen shapes, each one the full picker also offers", () => {
    const all = new Set(SHAPE_PICKER_CATEGORIES.flatMap((c) => c.kinds.map((k) => k.kind)));
    expect(BOARD_SHAPES).toHaveLength(12);
    for (const { kind, label } of BOARD_SHAPES) {
      expect(all.has(kind)).toBe(true);
      expect(label.trim()).not.toBe("");
    }
    expect(new Set(BOARD_SHAPES.map((s) => s.kind)).size).toBe(BOARD_SHAPES.length);
  });
});
