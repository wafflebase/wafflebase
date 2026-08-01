import { describe, it, expect } from "vitest";
import type { Frame, Viewport } from "@wafflebase/slides";
import {
  fitViewportToScene,
  createFitToContentOnce,
  FIT_CONTENT_FRACTION,
  MAX_FIT_ZOOM,
  MIN_FIT_ZOOM,
  type FitLatch,
} from "./fit-to-content";
import { sceneBounds } from "./minimap-geometry";

const frame = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});

const HOST = { w: 800, h: 600 };

/** Where a world point lands on screen under `vp`. */
const toScreen = (vp: Viewport, p: { x: number; y: number }) => ({
  x: p.x * vp.zoom + vp.panX,
  y: p.y * vp.zoom + vp.panY,
});

describe("fitViewportToScene", () => {
  it("returns undefined for an empty scene", () => {
    expect(fitViewportToScene(undefined, HOST)).toBeUndefined();
    expect(fitViewportToScene(sceneBounds([]), HOST)).toBeUndefined();
  });

  it("returns undefined before the host has any area", () => {
    const bounds = sceneBounds([frame(0, 0, 100, 100)]);
    expect(fitViewportToScene(bounds, { w: 0, h: 0 })).toBeUndefined();
  });

  it("zooms out for content larger than the host", () => {
    const bounds = sceneBounds([frame(0, 0, 4000, 3000)])!;
    const vp = fitViewportToScene(bounds, HOST)!;
    // 800*0.92/4000 === 600*0.92/3000 === 0.184
    expect(vp.zoom).toBeCloseTo((HOST.w * FIT_CONTENT_FRACTION) / 4000);
    expect(vp.zoom).toBeLessThan(1);
  });

  it("clamps magnification at 1 for tiny content", () => {
    // A lone sticky would otherwise fill the screen at ~7x.
    const bounds = sceneBounds([frame(0, 0, 100, 80)])!;
    expect(fitViewportToScene(bounds, HOST)!.zoom).toBe(MAX_FIT_ZOOM);
  });

  it("clamps at the viewport minimum for an enormous board", () => {
    const bounds = sceneBounds([frame(0, 0, 500_000, 400_000)])!;
    expect(fitViewportToScene(bounds, HOST)!.zoom).toBe(MIN_FIT_ZOOM);
  });

  it("puts the scene centre at the host centre, however far from the origin", () => {
    // Miro-like coordinates: nowhere near (0, 0).
    const bounds = sceneBounds([frame(41_000, -9_000, 2000, 1000)])!;
    const vp = fitViewportToScene(bounds, HOST)!;
    const centre = { x: 41_000 + 1000, y: -9_000 + 500 };
    const onScreen = toScreen(vp, centre);
    expect(onScreen.x).toBeCloseTo(HOST.w / 2);
    expect(onScreen.y).toBeCloseTo(HOST.h / 2);
  });

  it("leaves a margin — content does not touch the host edges", () => {
    const frames = [frame(1000, 1000, 4000, 3000)];
    const vp = fitViewportToScene(sceneBounds(frames), HOST)!;
    const tl = toScreen(vp, { x: 1000, y: 1000 });
    const br = toScreen(vp, { x: 5000, y: 4000 });
    expect(tl.x).toBeGreaterThan(0);
    expect(tl.y).toBeGreaterThan(0);
    expect(br.x).toBeLessThan(HOST.w);
    expect(br.y).toBeLessThan(HOST.h);
  });

  it("unions every frame, not just the first", () => {
    const vp = fitViewportToScene(
      sceneBounds([frame(0, 0, 100, 100), frame(3900, 2900, 100, 100)]),
      HOST,
    )!;
    const centre = toScreen(vp, { x: 2000, y: 1500 });
    expect(centre.x).toBeCloseTo(HOST.w / 2);
    expect(centre.y).toBeCloseTo(HOST.h / 2);
    expect(vp.zoom).toBeLessThan(1);
  });

  it("survives a degenerate zero-size frame with a finite zoom", () => {
    const vp = fitViewportToScene(sceneBounds([frame(10, 10, 0, 0)]), HOST)!;
    expect(Number.isFinite(vp.zoom)).toBe(true);
    expect(vp.zoom).toBe(MAX_FIT_ZOOM);
  });
});

describe("createFitToContentOnce", () => {
  const setup = (frames: Frame[]) => {
    const latch: FitLatch = { done: false };
    const applied: Viewport[] = [];
    let current = frames;
    const fit = createFitToContentOnce({
      latch,
      getFrames: () => current,
      getHostSize: () => HOST,
      apply: (vp) => applied.push(vp),
    });
    return { latch, applied, fit, setFrames: (f: Frame[]) => { current = f; } };
  };

  it("does nothing on an empty board, and stays unlatched", () => {
    const { fit, applied, latch } = setup([]);
    fit();
    fit();
    expect(applied).toHaveLength(0);
    expect(latch.done).toBe(false);
  });

  it("fits on the first attempt that finds content (post-sync)", () => {
    const { fit, applied, latch, setFrames } = setup([]);
    fit(); // mount: document not synced yet
    expect(applied).toHaveLength(0);

    setFrames([frame(5000, 5000, 400, 300)]);
    fit(); // first store.onChange after the sync
    expect(applied).toHaveLength(1);
    expect(latch.done).toBe(true);
    expect(toScreen(applied[0], { x: 5200, y: 5150 }).x).toBeCloseTo(HOST.w / 2);
  });

  it("never re-fits: a later remote change must not yank the viewport", () => {
    const { fit, applied, setFrames } = setup([frame(0, 0, 400, 300)]);
    fit();
    expect(applied).toHaveLength(1);

    // A peer adds an element far away; several change events land.
    setFrames([frame(0, 0, 400, 300), frame(90_000, 90_000, 400, 300)]);
    fit();
    fit();
    fit();
    expect(applied).toHaveLength(1);
  });

  it("honours a latch that is already closed (mount effect re-run)", () => {
    const latch: FitLatch = { done: true };
    const applied: Viewport[] = [];
    const fit = createFitToContentOnce({
      latch,
      getFrames: () => [frame(0, 0, 400, 300)],
      getHostSize: () => HOST,
      apply: (vp) => applied.push(vp),
    });
    fit();
    expect(applied).toHaveLength(0);
  });

  it("does not read frames again once latched", () => {
    const latch: FitLatch = { done: false };
    let reads = 0;
    const fit = createFitToContentOnce({
      latch,
      getFrames: () => { reads += 1; return [frame(0, 0, 400, 300)]; },
      getHostSize: () => HOST,
      apply: () => {},
    });
    fit();
    fit();
    fit();
    // `getFrames` deep-reads the whole board document — the latch must
    // short-circuit before that, not after.
    expect(reads).toBe(1);
  });
});
