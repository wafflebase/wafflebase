import { describe, expect, it, vi } from "vitest";
import type { Viewport } from "@wafflebase/board";
import {
  TAP_MAX_DURATION_MS,
  TOUCH_PAN_THRESHOLD_PX,
  createBoardTouchGestures,
  type BoardGestureHost,
} from "./board-touch-gestures";

/**
 * Host double. `content` is the set of client-x coordinates that count
 * as "an element is here"; everything else is empty canvas.
 */
function makeHost(options: { content?: (x: number, y: number) => boolean } = {}) {
  let viewport: Viewport = { panX: 0, panY: 0, zoom: 1 };
  const emptyTaps = vi.fn();
  const zoomChanges: number[] = [];
  const host: BoardGestureHost = {
    getViewport: () => viewport,
    commit: (next) => {
      viewport = next;
    },
    hasContentAt: options.content ?? (() => false),
    // Identity: the fake canvas sits at the viewport origin.
    toCanvasPoint: (x, y) => ({ x, y }),
    onEmptyTap: emptyTaps,
    onZoomChange: (z) => zoomChanges.push(z),
  };
  return {
    host,
    emptyTaps,
    zoomChanges,
    get viewport() {
      return viewport;
    },
  };
}

const at = (id: number, x: number, y: number, t = 0) => ({
  id,
  clientX: x,
  clientY: y,
  timeStamp: t,
});

describe("board touch gestures — ownership", () => {
  it("claims a press on empty canvas", () => {
    const { host } = makeHost();
    const g = createBoardTouchGestures(host);
    expect(g.down(at(1, 100, 100))).toBe(true);
  });

  it("concedes a press that lands on an element", () => {
    // The editor owns it: a finger on a shape moves the shape, exactly
    // as a mouse would. Claiming it would break element dragging.
    const { host } = makeHost({ content: () => true });
    const g = createBoardTouchGestures(host);
    expect(g.down(at(1, 100, 100))).toBe(false);
  });

  it("does not pan when the gesture was conceded", () => {
    const { host, viewport } = makeHost({ content: () => true });
    const g = createBoardTouchGestures(host);
    g.down(at(1, 100, 100));
    g.move(at(1, 300, 300));
    expect(viewport).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });

  it("keeps conceding the second finger of a conceded gesture", () => {
    // Otherwise lifting the first finger would promote the second into
    // a pan of its own, mid-element-drag.
    const { host } = makeHost({ content: (x) => x < 200 });
    const g = createBoardTouchGestures(host);
    expect(g.down(at(1, 100, 100))).toBe(false);
    expect(g.down(at(2, 400, 400))).toBe(false);
  });

  it("re-decides ownership once every finger has lifted", () => {
    const content = vi.fn().mockReturnValue(true);
    const { host } = makeHost({ content });
    const g = createBoardTouchGestures(host);
    expect(g.down(at(1, 100, 100))).toBe(false);
    g.up(at(1, 100, 100));
    content.mockReturnValue(false);
    expect(g.down(at(1, 100, 100))).toBe(true);
  });
});

describe("board touch gestures — one-finger pan", () => {
  it("ignores travel below the threshold", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.move(at(1, 100 + TOUCH_PAN_THRESHOLD_PX - 1, 100));
    expect(t.viewport.panX).toBe(0);
  });

  it("pans from the press point once the threshold is crossed", () => {
    // Not from where the threshold was crossed: the content must not
    // jump by the threshold on the gesture's first painted frame.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.move(at(1, 100 + TOUCH_PAN_THRESHOLD_PX, 100));
    expect(t.viewport.panX).toBe(TOUCH_PAN_THRESHOLD_PX);
    expect(t.viewport.panY).toBe(0);
  });

  it("accumulates across moves", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 0, 0));
    g.move(at(1, 50, 20));
    g.move(at(1, 80, 60));
    expect(t.viewport).toEqual({ panX: 80, panY: 60, zoom: 1 });
  });

  it("leaves the zoom untouched", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 0, 0));
    g.move(at(1, 200, 0));
    expect(t.viewport.zoom).toBe(1);
    expect(t.zoomChanges).toEqual([]);
  });
});

describe("board touch gestures — tap", () => {
  it("reports a tap on empty canvas", () => {
    // The claim above intercepted the editor's own empty-canvas path,
    // which is where a click normally clears the selection.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    g.up(at(1, 101, 101, 120));
    expect(t.emptyTaps).toHaveBeenCalledTimes(1);
  });

  it("does not report a pan as a tap", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    g.move(at(1, 300, 100, 50));
    g.up(at(1, 300, 100, 100));
    expect(t.emptyTaps).not.toHaveBeenCalled();
  });

  it("does not report a long press as a tap", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    g.up(at(1, 100, 100, TAP_MAX_DURATION_MS + 1));
    expect(t.emptyTaps).not.toHaveBeenCalled();
  });

  it("does not report a cancelled press as a tap", () => {
    // A cancel means the platform took the gesture away — a system edge
    // swipe, an ancestor claiming the scroll. The user did not tap.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    g.cancel(at(1, 100, 100, 50));
    expect(t.emptyTaps).not.toHaveBeenCalled();
  });
});

describe("board touch gestures — pinch", () => {
  it("zooms in as the fingers separate", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.down(at(2, 200, 100));
    // Distance 100 → 200 about the same midpoint: exactly 2x.
    g.move(at(1, 50, 100));
    g.move(at(2, 250, 100));
    expect(t.viewport.zoom).toBeCloseTo(2, 5);
    expect(t.zoomChanges.at(-1)).toBeCloseTo(2, 5);
  });

  it("zooms out as the fingers close", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 0, 0));
    g.down(at(2, 200, 0));
    g.move(at(1, 50, 0));
    g.move(at(2, 150, 0));
    expect(t.viewport.zoom).toBeCloseTo(0.5, 5);
  });

  it("holds the world point under the gesture midpoint still", () => {
    // The whole purpose of anchoring at the midpoint: whatever the user
    // has their fingers around must not slide out from under them.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.down(at(2, 300, 100));
    const mid = { x: 200, y: 100 };
    const worldBefore = {
      x: (mid.x - t.viewport.panX) / t.viewport.zoom,
      y: (mid.y - t.viewport.panY) / t.viewport.zoom,
    };
    g.move(at(1, 50, 100));
    g.move(at(2, 350, 100));
    const screenAfter = {
      x: worldBefore.x * t.viewport.zoom + t.viewport.panX,
      y: worldBefore.y * t.viewport.zoom + t.viewport.panY,
    };
    expect(screenAfter.x).toBeCloseTo(mid.x, 5);
    expect(screenAfter.y).toBeCloseTo(mid.y, 5);
  });

  it("pans by the midpoint travel while scaling", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.down(at(2, 200, 100));
    // Both fingers slide 40px right with the spread unchanged.
    g.move(at(1, 140, 100));
    g.move(at(2, 240, 100));
    expect(t.viewport.zoom).toBeCloseTo(1, 5);
    expect(t.viewport.panX).toBeCloseTo(40, 5);
  });

  it("continues as a pan when one finger lifts", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.down(at(2, 200, 100));
    g.up(at(2, 200, 100));
    const zoomAfterPinch = t.viewport.zoom;
    g.move(at(1, 150, 100));
    expect(t.viewport.zoom).toBe(zoomAfterPinch);
    expect(t.viewport.panX).toBeCloseTo(50, 5);
  });

  it("survives two fingers landing on the same point", () => {
    // A zero starting distance would make the scale factor infinite.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100));
    g.down(at(2, 100, 100));
    g.move(at(2, 140, 100));
    expect(Number.isFinite(t.viewport.zoom)).toBe(true);
    expect(t.viewport.zoom).toBe(1);
  });

  it("does not report a zoom change once clamped", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 1000, 0));
    g.down(at(2, 1001, 0));
    // Spread far enough to blow past the 8x ceiling in one step.
    g.move(at(2, 2000, 0));
    const clamped = t.viewport.zoom;
    t.zoomChanges.length = 0;
    g.move(at(2, 3000, 0));
    expect(t.viewport.zoom).toBe(clamped);
    expect(t.zoomChanges).toEqual([]);
  });
});
