// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LIVE_STROKE_WINDOW, decodeLivePoints } from "./board-live-ink";
import {
  LASER_FADE_MS,
  createLaserLayer,
  isLaserTrail,
  laserAlpha,
  laserPresence,
  pruneTrail,
} from "./board-laser";

describe("laser fade", () => {
  it("fades linearly to nothing over 1.5 s", () => {
    expect(LASER_FADE_MS).toBe(1500);
    expect(laserAlpha(0)).toBe(1);
    expect(laserAlpha(750)).toBeCloseTo(0.5);
    expect(laserAlpha(1500)).toBe(0);
    expect(laserAlpha(-5)).toBe(1);
  });

  it("prunes fully faded points from the tail end", () => {
    const trail = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1000 },
      { x: 2, y: 0, t: 2000 },
    ];
    expect(pruneTrail(trail, 2400).map((p) => p.x)).toEqual([1, 2]);
    expect(pruneTrail(trail, 1000)).toBe(trail);
  });
});

describe("laserPresence", () => {
  it("carries a bounded window and is never stored", () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    const trail = laserPresence(3, pts);
    expect(trail.id).toBe(3);
    expect(trail.base).toBe(100 - LIVE_STROKE_WINDOW);
    expect(decodeLivePoints(trail.points)).toHaveLength(LIVE_STROKE_WINDOW);
    expect(isLaserTrail(trail)).toBe(true);
    expect(isLaserTrail({ id: 1 })).toBe(false);
  });
});

describe("createLaserLayer", () => {
  function setup(reduced = false) {
    let t = 0;
    const frames: Array<() => void> = [];
    const container = document.createElement("div");
    const layer = createLaserLayer({
      container,
      getViewport: () => ({ panX: 0, panY: 0, zoom: 1 }),
      getHost: () => ({ w: 100, h: 100 }),
      dpr: 1,
      reducedMotion: () => reduced,
      now: () => t,
      requestFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: () => undefined,
    });
    const flush = () => {
      while (frames.length) frames.shift()!();
    };
    return { container, layer, flush, tick: (ms: number) => (t += ms), frames };
  }

  it("mounts a pointer-transparent canvas and stops animating once faded", () => {
    const s = setup();
    const canvas = s.container.querySelector("canvas[data-board-laser]") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.style.pointerEvents).toBe("none");
    s.layer.addLocal({ x: 1, y: 1 });
    s.layer.addLocal({ x: 5, y: 5 });
    // One frame paints and books the next while the trail is live.
    s.frames.shift()!();
    expect(s.frames).toHaveLength(1);
    s.tick(LASER_FADE_MS + 1);
    s.flush();
    expect(s.frames).toHaveLength(0);
    s.layer.dispose();
    expect(s.container.querySelector("canvas")).toBeNull();
  });

  it("takes a peer's trail from presence and lets it fade after it clears", () => {
    const s = setup(true);
    const trail = laserPresence(1, [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    s.layer.updatePeers([{ clientID: "p", presence: { laser: trail } }]);
    s.frames.shift()!();
    // Still live: a frame is booked.
    expect(s.frames).toHaveLength(1);
    s.layer.updatePeers([{ clientID: "p", presence: { laser: null } }]);
    s.tick(LASER_FADE_MS + 1);
    s.flush();
    expect(s.frames).toHaveLength(0);
  });
});
