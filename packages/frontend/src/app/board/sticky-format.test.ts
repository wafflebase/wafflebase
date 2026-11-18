import { describe, it, expect } from "vitest";
import type { Element } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { YorkieBoardStore } from "./yorkie-board-store";
import { makeYorkieBoardDoc } from "./__testkit__";
import { buildStickyInit } from "./sticky";
import {
  STICKY_SIZE_PRESETS,
  applyStickyFontSize,
  applyStickyShowAuthor,
  applyStickySize,
  hasAnonymity,
  stepStickyFontSize,
  stickyFontSize,
  stickyKeepsAspect,
  stickyShowsAuthor,
  stickySizePresetOf,
} from "./sticky-format";

function boardWith(...inits: ReturnType<typeof buildStickyInit>[]) {
  const store = new YorkieBoardStore(makeYorkieBoardDoc());
  const ids: string[] = [];
  store.batch(() => {
    for (const init of inits) ids.push(store.addElement(SYNTHETIC_SLIDE_ID, init));
  });
  const els = (): Element[] => store.read().slides[0].elements;
  return { store, ids, els };
}

describe("sticky size presets", () => {
  it("names the preset a frame matches", () => {
    expect(stickySizePresetOf({ w: 180, h: 180 })?.id).toBe("m");
    expect(stickySizePresetOf({ w: 360, h: 180 })?.id).toBe("wide");
    expect(stickySizePresetOf({ w: 181.5, h: 180 })).toBeUndefined();
  });

  it("resizes about the centre in one undo unit", () => {
    const { store, ids, els } = boardWith(buildStickyInit("#FFF8B8", { x: 0, y: 0 }));
    const wide = STICKY_SIZE_PRESETS.find((p) => p.id === "wide")!;
    applyStickySize(store, els(), ids, wide);
    expect(els()[0].frame).toMatchObject({ x: -180, y: -90, w: 360, h: 180 });
    store.undo();
    expect(els()[0].frame).toMatchObject({ x: -90, y: -90, w: 180, h: 180 });
  });

  it("locks the aspect of a square sticky only", () => {
    expect(stickyKeepsAspect({ frame: { w: 180, h: 180 } })).toBe(true);
    expect(stickyKeepsAspect({ frame: { w: 360, h: 180 } })).toBe(false);
  });
});

describe("sticky text size", () => {
  it("steps along the ladder, clamped at both ends", () => {
    expect(stepStickyFontSize(18, 1)).toBe(24);
    expect(stepStickyFontSize(18, -1)).toBe(14);
    expect(stepStickyFontSize(20, -1)).toBe(18);
    expect(stepStickyFontSize(96, 1)).toBe(96);
    expect(stepStickyFontSize(10, -1)).toBe(10);
  });

  it("sets every run of every selected sticky in one batch, keeping shrink-to-fit", () => {
    const a = buildStickyInit("#FFF8B8", { x: 0, y: 0 }, { text: "hi" });
    const b = buildStickyInit("#FFF8B8", { x: 300, y: 0 });
    const { store, ids, els } = boardWith(a, b);
    applyStickyFontSize(store, els(), ids, 48);
    for (const el of els()) {
      expect(stickyFontSize(el)).toBe(48);
      expect(el.type === "shape" && el.data.text?.autofit).toBe("shrink");
    }
    const first = els()[0];
    expect(first.type === "shape" && first.data.text?.blocks[0].inlines[0].text).toBe("hi");
    store.undo();
    expect(stickyFontSize(els()[0])).toBe(18);
  });
});

describe("sticky author tag", () => {
  it("toggles per sticky, absent meaning shown", () => {
    const { store, ids, els } = boardWith(
      buildStickyInit("#FFF8B8", { x: 0, y: 0 }, { author: "Ada" }),
    );
    expect(stickyShowsAuthor(els()[0])).toBe(true);
    applyStickyShowAuthor(store, ids, false);
    expect(stickyShowsAuthor(els()[0])).toBe(false);
    applyStickyShowAuthor(store, ids, true);
    expect("showAuthor" in (els()[0] as unknown as { data: object }).data).toBe(false);
  });

  it("recognises a store with the anonymous setting", () => {
    expect(hasAnonymity(new YorkieBoardStore(makeYorkieBoardDoc()))).toBe(true);
    expect(hasAnonymity({ read: () => null })).toBe(false);
    expect(hasAnonymity(null)).toBe(false);
  });
});
