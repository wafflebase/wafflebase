import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORT } from "@wafflebase/board";
import { applyWheelToViewport } from "./board-wheel";

describe("applyWheelToViewport", () => {
  it("zooms in about the cursor on ctrlKey + negative deltaY", () => {
    const next = applyWheelToViewport(DEFAULT_VIEWPORT, {
      ctrlKey: true,
      metaKey: false,
      deltaX: 0,
      deltaY: -10,
      offsetX: 100,
      offsetY: 50,
    });
    expect(next.zoom).toBeCloseTo(1.1);
    // The world point under the cursor must stay fixed on screen.
    expect(next.panX + 100 * next.zoom).toBeCloseTo(100);
    expect(next.panY + 50 * next.zoom).toBeCloseTo(50);
  });

  it("zooms out on positive deltaY", () => {
    const next = applyWheelToViewport(DEFAULT_VIEWPORT, {
      ctrlKey: true,
      metaKey: false,
      deltaX: 0,
      deltaY: 10,
      offsetX: 0,
      offsetY: 0,
    });
    expect(next.zoom).toBeCloseTo(1 / 1.1);
  });

  it("treats metaKey the same as ctrlKey (Mac pinch-zoom)", () => {
    const next = applyWheelToViewport(DEFAULT_VIEWPORT, {
      ctrlKey: false,
      metaKey: true,
      deltaX: 0,
      deltaY: -10,
      offsetX: 0,
      offsetY: 0,
    });
    expect(next.zoom).toBeCloseTo(1.1);
  });

  it("pans, inverted, on a plain wheel with no modifier", () => {
    const next = applyWheelToViewport(DEFAULT_VIEWPORT, {
      ctrlKey: false,
      metaKey: false,
      deltaX: 10,
      deltaY: 20,
      offsetX: 0,
      offsetY: 0,
    });
    expect(next).toEqual({ panX: -10, panY: -20, zoom: 1 });
  });

  it("repeated zoom-at-cursor ticks keep the same anchor fixed", () => {
    let vp = DEFAULT_VIEWPORT;
    const anchor = { x: 200, y: 150 };
    for (let i = 0; i < 5; i++) {
      vp = applyWheelToViewport(vp, {
        ctrlKey: true,
        metaKey: false,
        deltaX: 0,
        deltaY: -10,
        offsetX: anchor.x,
        offsetY: anchor.y,
      });
    }
    expect(vp.panX + anchor.x * vp.zoom).toBeCloseTo(anchor.x);
    expect(vp.panY + anchor.y * vp.zoom).toBeCloseTo(anchor.y);
  });
});
