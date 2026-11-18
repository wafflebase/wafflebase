import { describe, it, expect } from "vitest";
import type { Element, Frame } from "@wafflebase/slides";
import { buildSectionInit } from "@wafflebase/board";
import {
  TITLE_HEIGHT_PX,
  TITLE_INSET_PX,
  paintSections,
  titleLabel,
  titleRect,
  truncateToWidth,
} from "./board-section-paint";

const f = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

function section(id: string, frame: Frame, meta: Record<string, unknown> = {}): Element {
  const init = buildSectionInit(frame, { title: id }) as unknown as {
    data: { section: Record<string, unknown> };
  };
  init.data.section = { ...init.data.section, ...meta };
  return { ...init, id } as unknown as Element;
}

function sticky(id: string, frame: Frame): Element {
  return { id, type: "shape", frame, data: { kind: "rect" } } as Element;
}

/** A 2D context that records the text it is asked to draw. */
function recordingCtx() {
  const texts: string[] = [];
  const noop = () => undefined;
  const ctx = {
    texts,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    // One world px per character keeps the arithmetic readable.
    measureText: (s: string) => ({ width: s.length }),
    fillText: (s: string) => texts.push(s),
    fillRect: noop, strokeRect: noop, beginPath: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, moveTo: noop, lineTo: noop, save: noop, restore: noop,
  };
  return ctx;
}

describe("titleLabel", () => {
  it("names the state beside the title", () => {
    expect(titleLabel({ title: "Ideas" })).toBe("Ideas");
    expect(titleLabel({ title: "Ideas", locked: true, hidden: true })).toBe("Ideas · Locked, Hidden");
    expect(titleLabel({ title: "  " })).toBe("Untitled section");
  });
});

describe("truncateToWidth", () => {
  const measure = (s: string) => s.length;
  it("keeps what fits and ellipsizes what does not", () => {
    expect(truncateToWidth("abc", 5, measure)).toBe("abc");
    expect(truncateToWidth("abcdefgh", 5, measure)).toBe("abcd…");
    expect(truncateToWidth("abcdefgh", 1, measure)).toBe("…");
    expect(truncateToWidth("abcdefgh", 0, measure)).toBe("");
  });
});

describe("titleRect", () => {
  it("keeps a constant screen size, so its world size shrinks as zoom grows", () => {
    const at1 = titleRect(f(0, 0, 1000, 1000), 1, 50)!;
    const at2 = titleRect(f(0, 0, 1000, 1000), 2, 50)!;
    expect(at1.h).toBe(TITLE_HEIGHT_PX);
    expect(at2.h).toBe(TITLE_HEIGHT_PX / 2);
    expect(at1.x).toBe(TITLE_INSET_PX);
    expect(at2.w * 2).toBeCloseTo(at1.w);
  });

  it("caps the pill to the section and drops it on a tiny section", () => {
    expect(titleRect(f(0, 0, 100, 100), 1, 500)!.w).toBe(100 - TITLE_INSET_PX * 2);
    // 100 world px at 10% is 10 screen px: no room for a title.
    expect(titleRect(f(0, 0, 100, 100), 0.1, 50)).toBeNull();
  });
});

describe("paintSections", () => {
  it("titles every section", () => {
    const ctx = recordingCtx();
    paintSections(ctx as unknown as CanvasRenderingContext2D, [
      section("A", f(0, 0, 500, 500)),
      section("B", f(1000, 0, 500, 500), { locked: true }),
    ], 1);
    expect(ctx.texts).toEqual(["A", "B · Locked"]);
  });

  it("covers a hidden section's contents, nested section titles included", () => {
    const ctx = recordingCtx();
    paintSections(ctx as unknown as CanvasRenderingContext2D, [
      section("Outer", f(0, 0, 1000, 1000), { hidden: true }),
      section("Inner", f(100, 100, 300, 300)),
      sticky("s", f(500, 500, 50, 50)),
    ], 1);
    // Two members (Inner, s); Inner's title is under the cover.
    expect(ctx.texts).toEqual(["2 hidden items", "Outer · Hidden"]);
  });

  it("draws no titles in the minimap's mode, only covers", () => {
    const ctx = recordingCtx();
    paintSections(ctx as unknown as CanvasRenderingContext2D, [
      section("Outer", f(0, 0, 1000, 1000), { hidden: true }),
      sticky("s", f(500, 500, 50, 50)),
      section("Other", f(3000, 0, 500, 500)),
    ], 1, { titles: false });
    expect(ctx.texts).toEqual(["1 hidden item"]);
  });
});
