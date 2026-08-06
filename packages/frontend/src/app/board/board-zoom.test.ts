import { describe, expect, it } from "vitest";
import type { Frame } from "@wafflebase/slides";
import { DEFAULT_VIEWPORT } from "@wafflebase/board";
import { FIT_ZOOM } from "../slides/zoom-controller";
import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  applyZoomValue,
  createBoardZoomBinding,
  createBoardZoomController,
} from "./board-zoom";
import type { Viewport } from "@wafflebase/board";

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

  // DEFAULT_VIEWPORT.zoom is 1, which makes `target / vp.zoom` and a bare
  // `target` indistinguishable — every case above would pass even if the
  // division were deleted. These two pin the conversion from a starting
  // zoom that is NOT 1, so the factor math is actually exercised.
  it("converts the absolute target through a non-1 starting zoom (0.5)", () => {
    const vp = { panX: 10, panY: -20, zoom: 0.5 };
    const next = applyZoomValue(vp, 2, host, frames);
    expect(next).toBeDefined();
    expect(next!.zoom).toBe(2); // NOT vp.zoom * 2 = 1
    // The world point under the host centre before the call, computed from
    // the ACTUAL starting viewport, must still be under the host centre
    // after it.
    const centreWorldBefore = {
      x: (host.w / 2 - vp.panX) / vp.zoom,
      y: (host.h / 2 - vp.panY) / vp.zoom,
    };
    expect(centreWorldBefore.x * next!.zoom + next!.panX).toBeCloseTo(host.w / 2);
    expect(centreWorldBefore.y * next!.zoom + next!.panY).toBeCloseTo(host.h / 2);
  });

  it("converts the absolute target through a non-1 starting zoom (4)", () => {
    const vp = { panX: -50, panY: 30, zoom: 4 };
    const next = applyZoomValue(vp, 0.5, host, frames);
    expect(next).toBeDefined();
    expect(next!.zoom).toBe(0.5); // NOT vp.zoom * 0.5 = 2
    const centreWorldBefore = {
      x: (host.w / 2 - vp.panX) / vp.zoom,
      y: (host.h / 2 - vp.panY) / vp.zoom,
    };
    expect(centreWorldBefore.x * next!.zoom + next!.panX).toBeCloseTo(host.w / 2);
    expect(centreWorldBefore.y * next!.zoom + next!.panY).toBeCloseTo(host.h / 2);
  });
});

describe("createBoardZoomBinding", () => {
  /**
   * Board-view's wiring in miniature: a live viewport the binding
   * commits into, plus counters for the two things a label-only write
   * must NOT trigger (a commit, and a scene read).
   */
  function harness(initialZoom = FIT_ZOOM) {
    const controller = createBoardZoomController(initialZoom);
    let viewport: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const commits: Viewport[] = [];
    let frameReads = 0;
    const binding = createBoardZoomBinding(controller, {
      getViewport: () => viewport,
      getHost: () => host,
      getFrames: () => {
        frameReads++;
        return frames;
      },
      commit: (next) => {
        viewport = next;
        commits.push(next);
      },
    });
    return {
      binding,
      controller,
      commits,
      get viewport() {
        return viewport;
      },
      /** Simulate a pan gesture: moves the viewport, changes no scale. */
      panAway: () => {
        viewport = { ...viewport, panX: viewport.panX - 5000, panY: viewport.panY - 5000 };
      },
      get frameReads() {
        return frameReads;
      },
    };
  }

  /** The scene centre (200, 150) must land at the host centre. */
  function expectFramed(vp: Viewport) {
    expect(200 * vp.zoom + vp.panX).toBeCloseTo(host.w / 2);
    expect(150 * vp.zoom + vp.panY).toBeCloseTo(host.h / 2);
  }

  // THE regression this binding exists for. A board sits at FIT_ZOOM by
  // default, and `set()` deliberately early-returns on an unchanged
  // value — so routing Fit through the value channel alone makes the
  // menu item dead in exactly the state users meet it in.
  it("re-frames the content when Fit is picked at the default FIT_ZOOM", () => {
    const h = harness(); // default value === FIT_ZOOM
    expect(h.controller.get()).toBe(FIT_ZOOM);
    h.panAway();

    h.binding.controller.set(FIT_ZOOM);

    expect(h.commits).toHaveLength(1);
    expectFramed(h.viewport);
    // …and the readout still says "Fit".
    expect(h.controller.get()).toBe(FIT_ZOOM);
  });

  it("re-frames again after a Fit already left the value at FIT_ZOOM", () => {
    const h = harness();
    h.binding.controller.set(FIT_ZOOM);
    h.panAway();

    h.binding.controller.set(FIT_ZOOM);

    expect(h.commits).toHaveLength(2);
    expectFramed(h.viewport);
  });

  it("fit() re-frames directly (the context menu's Fit to content)", () => {
    const h = harness();
    h.panAway();
    h.binding.fit();
    expect(h.commits).toHaveLength(1);
    expectFramed(h.viewport);
  });

  it("commits a preset about the host centre without reading the scene", () => {
    const h = harness(1);
    h.binding.controller.set(2);
    expect(h.commits).toHaveLength(1);
    expect(h.viewport.zoom).toBe(2);
    expect(h.controller.get()).toBe(2);
    // The preset branch discards frames; reading them would be a full
    // scene walk computed and thrown away.
    expect(h.frameReads).toBe(0);
  });

  // A wheel tick has ALREADY applied its scale to the viewport, anchored
  // at the cursor. Re-resolving it here would re-anchor it about the
  // host centre and walk the point under the cursor away.
  it("reportViewportZoom updates the label without touching the viewport", () => {
    const h = harness(1);
    const before = h.viewport;

    h.binding.reportViewportZoom(1.5);

    expect(h.controller.get()).toBe(1.5);
    expect(h.commits).toHaveLength(0);
    expect(h.viewport).toBe(before);
    expect(h.frameReads).toBe(0);
  });
});
