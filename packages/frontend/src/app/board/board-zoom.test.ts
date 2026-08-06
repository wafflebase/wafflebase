import { describe, expect, it } from "vitest";
import type { Frame } from "@wafflebase/slides";
import { DEFAULT_VIEWPORT } from "@wafflebase/board";
import { FIT_ZOOM } from "../slides/zoom-controller";
import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  applyZoomValue,
  createBoardZoomController,
} from "./board-zoom";

const host = { w: 800, h: 600 };
const frames: Frame[] = [{ x: 0, y: 0, w: 400, h: 300, rotation: 0 }];

describe("createBoardZoomController", () => {
  it("clamps to the board range, not the slides range", () => {
    const c = createBoardZoomController();
    c.set(0.15);
    expect(c.get()).toBe(0.15); // slides would have clamped up to 0.25
    c.set(6);
    expect(c.get()).toBe(6); // slides would have clamped down to 4
    c.set(0.01);
    expect(c.get()).toBe(BOARD_MIN_ZOOM);
    c.set(99);
    expect(c.get()).toBe(BOARD_MAX_ZOOM);
  });

  it("preserves the FIT sentinel through clamping", () => {
    const c = createBoardZoomController();
    c.set(2);
    c.set(FIT_ZOOM);
    expect(c.get()).toBe(FIT_ZOOM);
  });

  it("notifies subscribers only when the value actually changes", () => {
    const c = createBoardZoomController(1);
    let calls = 0;
    const off = c.subscribe(() => calls++);
    c.set(1);
    expect(calls).toBe(0);
    c.set(2);
    expect(calls).toBe(1);
    off();
    c.set(3);
    expect(calls).toBe(1);
  });
});

describe("applyZoomValue", () => {
  it("zooms to a preset about the host centre", () => {
    const next = applyZoomValue(DEFAULT_VIEWPORT, 2, host, frames);
    expect(next).toBeDefined();
    expect(next!.zoom).toBe(2);
    // The world point under the host centre must stay under it.
    const centreWorldBefore = {
      x: (host.w / 2 - DEFAULT_VIEWPORT.panX) / DEFAULT_VIEWPORT.zoom,
      y: (host.h / 2 - DEFAULT_VIEWPORT.panY) / DEFAULT_VIEWPORT.zoom,
    };
    expect(centreWorldBefore.x * next!.zoom + next!.panX).toBeCloseTo(host.w / 2);
    expect(centreWorldBefore.y * next!.zoom + next!.panY).toBeCloseTo(host.h / 2);
  });

  it("frames all content on FIT", () => {
    const next = applyZoomValue(DEFAULT_VIEWPORT, FIT_ZOOM, host, frames);
    expect(next).toBeDefined();
    // The scene centre (200, 150) lands at the host centre.
    expect(200 * next!.zoom + next!.panX).toBeCloseTo(host.w / 2);
    expect(150 * next!.zoom + next!.panY).toBeCloseTo(host.h / 2);
  });

  it("returns undefined on FIT with an empty scene", () => {
    expect(applyZoomValue(DEFAULT_VIEWPORT, FIT_ZOOM, host, [])).toBeUndefined();
  });

  it("returns undefined for a zero-area host", () => {
    expect(applyZoomValue(DEFAULT_VIEWPORT, 2, { w: 0, h: 0 }, frames)).toBeUndefined();
  });
});
