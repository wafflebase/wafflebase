import { describe, expect, it } from "vitest";
import {
  BOARD_SHAPE_FILL,
  BOARD_SHAPE_STROKE,
  boardShapeInsertStyle,
} from "./board-shape-style";

describe("boardShapeInsertStyle", () => {
  it("swaps the accent block for a light tint with a darker outline", () => {
    const style = boardShapeInsertStyle("rect", {
      fill: { kind: "role", role: "accent1" },
      stroke: { color: { kind: "role", role: "text" }, width: 1 },
    });
    expect(style.fill).toEqual({ kind: "srgb", value: BOARD_SHAPE_FILL });
    expect(style.stroke).toEqual({
      color: { kind: "srgb", value: BOARD_SHAPE_STROKE },
      width: 2,
    });
  });

  it("keeps an outlined callout's defaults", () => {
    const defaults = {
      fill: { kind: "role" as const, role: "background" as const },
      stroke: { color: { kind: "role" as const, role: "text" as const }, width: 2 },
    };
    expect(boardShapeInsertStyle("wedgeRectCallout", defaults)).toBe(defaults);
  });

  it("keeps a stroke-only shape's defaults", () => {
    const defaults = {
      stroke: { color: { kind: "role" as const, role: "text" as const }, width: 2 },
    };
    expect(boardShapeInsertStyle("arc", defaults)).toBe(defaults);
  });
});
