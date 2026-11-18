import { describe, expect, it } from "vitest";
import type { Frame } from "@wafflebase/slides";
import type { Viewport } from "@wafflebase/board";
import { FIT_ZOOM } from "../slides/zoom-controller";
import { fitViewportToScene, createFitToContentOnce } from "./fit-to-content";
import { sceneBounds } from "./minimap-geometry";
import {
  createBoardZoomBinding,
  createBoardZoomController,
  selectionFitViewport,
} from "./board-zoom";
import type { FitInsets } from "./fit-insets";

/**
 * Fit vs the floating chrome (the minimap in the bottom-right corner) and
 * the zoom readout after a fit.
 */
const HOST = { w: 1280, h: 720 };
const MINIMAP: FitInsets = { top: 0, right: 212, bottom: 0, left: 0 };
const frame = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});
const toScreen = (vp: Viewport, p: { x: number; y: number }) => ({
  x: p.x * vp.zoom + vp.panX,
  y: p.y * vp.zoom + vp.panY,
});

describe("fit with overlay insets", () => {
  it("keeps the fitted content clear of an inset edge", () => {
    const frames = [frame(0, 0, 4000, 1000)];
    const vp = fitViewportToScene(sceneBounds(frames), HOST, 1, MINIMAP)!;
    const br = toScreen(vp, { x: 4000, y: 1000 });
    expect(br.x).toBeLessThanOrEqual(HOST.w - MINIMAP.right);
    // Centred in the remaining box, not the whole host.
    const centre = toScreen(vp, { x: 2000, y: 500 });
    expect(centre.x).toBeCloseTo((HOST.w - MINIMAP.right) / 2);
    expect(centre.y).toBeCloseTo(HOST.h / 2);
  });

  it("matches the old fit with no insets", () => {
    const bounds = sceneBounds([frame(10, 20, 3000, 2000)]);
    expect(fitViewportToScene(bounds, HOST, 1, undefined)).toEqual(
      fitViewportToScene(bounds, HOST),
    );
  });

  it("falls back to the whole host when insets would leave no box", () => {
    const vp = fitViewportToScene(sceneBounds([frame(0, 0, 100, 100)]), HOST, 1, {
      top: 0, right: 2000, bottom: 0, left: 0,
    })!;
    expect(toScreen(vp, { x: 50, y: 50 }).x).toBeCloseTo(HOST.w / 2);
  });

  it("selection fit (Shift+2) honours the insets", () => {
    const elements = [{ id: "a", frame: frame(0, 0, 4000, 500) }];
    const vp = selectionFitViewport(elements, ["a"], HOST, MINIMAP)!;
    expect(toScreen(vp, { x: 4000, y: 0 }).x).toBeLessThanOrEqual(HOST.w - MINIMAP.right);
  });

  it("the open-time fit reads the insets", () => {
    let applied: Viewport | undefined;
    const fit = createFitToContentOnce({
      latch: { done: false },
      getFrames: () => [frame(0, 0, 4000, 1000)],
      getHostSize: () => HOST,
      getInsets: () => MINIMAP,
      apply: (vp) => {
        applied = vp;
      },
    });
    fit();
    expect(toScreen(applied!, { x: 4000, y: 0 }).x).toBeLessThanOrEqual(
      HOST.w - MINIMAP.right,
    );
  });
});

describe("zoom readout after Fit", () => {
  function harness() {
    const controller = createBoardZoomController(FIT_ZOOM);
    let viewport: Viewport = { panX: 0, panY: 0, zoom: 1 };
    // Mirrors board-view: every commit reports back through noteViewport.
    const commit = (next: Viewport) => {
      viewport = next;
      binding.noteViewport(next);
    };
    const binding = createBoardZoomBinding(controller, {
      getViewport: () => viewport,
      getHost: () => HOST,
      getFrames: () => [frame(0, 0, 4000, 3000)],
      getInsets: () => MINIMAP,
      commit,
    });
    return { controller, binding, commit, get viewport() { return viewport; } };
  }

  it("stays on Fit through the fit's own commit", () => {
    const h = harness();
    h.binding.fit();
    expect(h.controller.get()).toBe(FIT_ZOOM);
  });

  it("shows the percentage once the user pans away from the fit", () => {
    const h = harness();
    h.binding.fit();
    const fittedZoom = h.viewport.zoom;
    h.commit({ ...h.viewport, panX: h.viewport.panX + 40 });
    expect(h.controller.get()).toBeCloseTo(fittedZoom);
  });

  it("an open-time fit marked as fitted keeps Fit, then a pan leaves it", () => {
    const h = harness();
    const fitted = { panX: 10, panY: 20, zoom: 0.5 };
    h.binding.markFitted(fitted);
    h.commit(fitted);
    expect(h.controller.get()).toBe(FIT_ZOOM);
    h.commit({ ...fitted, panY: 30 });
    expect(h.controller.get()).toBe(0.5);
  });

  it("a preset is untouched by later commits", () => {
    const h = harness();
    h.binding.controller.set(2);
    h.commit({ ...h.viewport, panX: 99 });
    expect(h.controller.get()).toBe(2);
  });
});
