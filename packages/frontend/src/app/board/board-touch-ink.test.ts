import { describe, expect, it, vi } from "vitest";
import type { Viewport } from "@wafflebase/board";
import {
  createBoardTouchGestures,
  type BoardGestureHost,
} from "./board-touch-gestures";

/** A drawing tool is armed: one finger draws, two fingers navigate. */
function makeHost(inkArmed: boolean) {
  let viewport: Viewport = { panX: 0, panY: 0, zoom: 1 };
  const interrupted = vi.fn();
  const host: BoardGestureHost = {
    getViewport: () => viewport,
    commit: (next) => {
      viewport = next;
    },
    hasContentAt: () => false,
    toCanvasPoint: (x, y) => ({ x, y }),
    onEmptyTap: () => {},
    onLongPress: () => true,
    onZoomChange: () => {},
    setTimer: () => () => {},
    isInkArmed: () => inkArmed,
    onInkInterrupted: interrupted,
  };
  return {
    host,
    interrupted,
    get viewport() {
      return viewport;
    },
  };
}

const at = (id: number, x: number, y: number) => ({
  id,
  clientX: x,
  clientY: y,
  timeStamp: 0,
});

describe("board touch gestures — ink armed", () => {
  it("concedes a single finger on empty canvas so it draws, not pans", () => {
    const h = makeHost(true);
    const g = createBoardTouchGestures(h.host);
    expect(g.down(at(1, 100, 100))).toBe(false);
    g.move(at(1, 200, 160));
    g.up(at(1, 200, 160));
    expect(h.viewport).toEqual({ panX: 0, panY: 0, zoom: 1 });
    expect(h.interrupted).not.toHaveBeenCalled();
  });

  it("a second finger takes the gesture back as a pinch and drops the stroke", () => {
    const h = makeHost(true);
    const g = createBoardTouchGestures(h.host);
    expect(g.down(at(1, 100, 100))).toBe(false);
    g.move(at(1, 110, 100));
    expect(g.down(at(2, 210, 100))).toBe(true);
    expect(h.interrupted).toHaveBeenCalledTimes(1);
    // Spread the fingers: zoom in.
    g.move(at(2, 310, 100));
    expect(h.viewport.zoom).toBeGreaterThan(1);
    g.up(at(2, 310, 100));
    g.up(at(1, 110, 100));
    // The next single finger draws again.
    expect(g.down(at(3, 50, 50))).toBe(false);
  });

  it("pans on empty canvas as before when nothing is armed", () => {
    const h = makeHost(false);
    const g = createBoardTouchGestures(h.host);
    expect(g.down(at(1, 100, 100))).toBe(true);
  });
});
