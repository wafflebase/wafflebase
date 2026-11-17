import { describe, expect, it } from "vitest";
import {
  BOARD_OVERLAY_ATTR,
  insetsAvoiding,
  measureOverlayInsets,
  NO_INSETS,
} from "./fit-insets";

const HOST = { w: 1280, h: 720 };

describe("insetsAvoiding", () => {
  it("is all zero with no obstacles", () => {
    expect(insetsAvoiding(HOST, [])).toEqual(NO_INSETS);
  });

  it("insets the cheaper edge of a corner overlay (the minimap)", () => {
    // 200x150 panel + toggle, 12px off the bottom-right corner.
    const minimap = { x: 1280 - 212, y: 720 - 190, w: 200, h: 178 };
    const insets = insetsAvoiding(HOST, [minimap]);
    // Right costs 212/1280 = 17% of the width; bottom 190/720 = 26% of
    // the height — so the right edge is given up.
    expect(insets).toEqual({ top: 0, right: 212, bottom: 0, left: 0 });
  });

  it("insets the bottom for a wide bottom-centre dock", () => {
    const dock = { x: 400, y: 720 - 72, w: 480, h: 56 };
    expect(insetsAvoiding(HOST, [dock])).toEqual({
      top: 0, right: 0, bottom: 72, left: 0,
    });
  });

  it("ignores an overlay that touches no edge", () => {
    expect(insetsAvoiding(HOST, [{ x: 500, y: 300, w: 100, h: 100 }])).toEqual(NO_INSETS);
  });

  it("combines overlays per edge by the larger inset", () => {
    const insets = insetsAvoiding(HOST, [
      { x: 1280 - 212, y: 720 - 190, w: 200, h: 178 },
      { x: 1280 - 100, y: 12, w: 88, h: 40 },
    ]);
    expect(insets.right).toBe(212);
  });

  it("gives an axis back rather than inset away more than half of it", () => {
    const insets = insetsAvoiding(HOST, [
      { x: 0, y: 0, w: 400, h: 720 },
      { x: 880, y: 0, w: 400, h: 720 },
    ]);
    expect(insets.left).toBe(0);
    expect(insets.right).toBe(0);
  });

  it("skips zero-size (hidden) overlays", () => {
    expect(insetsAvoiding(HOST, [{ x: 1270, y: 700, w: 0, h: 0 }])).toEqual(NO_INSETS);
  });
});

describe("measureOverlayInsets", () => {
  it("reads marked overlays beside the container, relative to it", () => {
    const wrapper = document.createElement("div");
    const container = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.setAttribute(BOARD_OVERLAY_ATTR, "");
    wrapper.append(container, overlay);
    container.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 1280, height: 720 }) as DOMRect;
    overlay.getBoundingClientRect = () =>
      ({ left: 100 + 1068, top: 50 + 530, width: 200, height: 178 }) as DOMRect;
    expect(measureOverlayInsets(container, HOST).right).toBe(212);
  });
});
