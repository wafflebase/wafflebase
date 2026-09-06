import { describe, expect, it, vi } from "vitest";
import type { Viewport } from "@wafflebase/board";
import {
  TAP_MAX_DURATION_MS,
  TOUCH_PAN_THRESHOLD_PX,
  attachBoardTouchGestures,
  createBoardTouchGestures,
  type BoardGestureHost,
} from "./board-touch-gestures";

/**
 * Host double. `content` is the set of client-x coordinates that count
 * as "an element is here"; everything else is empty canvas.
 */
function makeHost(
  options: {
    content?: (x: number, y: number) => boolean;
    /** false models a read-only mount, which has no menu to open. */
    menuOpens?: boolean;
  } = {},
) {
  let viewport: Viewport = { panX: 0, panY: 0, zoom: 1 };
  const emptyTaps = vi.fn();
  const longPresses = vi.fn();
  const zoomChanges: number[] = [];
  // Hand-driven clock: `fireTimers()` runs whatever is still pending,
  // which is exactly the question every long-press test asks — was the
  // timer still armed when the delay elapsed?
  let pending: (() => void)[] = [];
  const host: BoardGestureHost = {
    getViewport: () => viewport,
    commit: (next) => {
      viewport = next;
    },
    hasContentAt: options.content ?? (() => false),
    // Identity: the fake canvas sits at the viewport origin.
    toCanvasPoint: (x, y) => ({ x, y }),
    onEmptyTap: emptyTaps,
    onLongPress: (x: number, y: number) => {
      longPresses(x, y);
      return options.menuOpens ?? true;
    },
    onZoomChange: (z) => zoomChanges.push(z),
    setTimer: (fn) => {
      pending.push(fn);
      return () => {
        pending = pending.filter((p) => p !== fn);
      };
    },
  };
  return {
    host,
    emptyTaps,
    longPresses,
    zoomChanges,
    fireTimers: () => {
      const due = pending;
      pending = [];
      for (const fn of due) fn();
    },
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

describe("board touch gestures — long press", () => {
  it("opens the menu at the press point when held still", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 120, 80, 0));
    t.fireTimers();
    expect(t.longPresses).toHaveBeenCalledWith(120, 80);
  });

  it("does not fire once the press became a pan", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 120, 80, 0));
    g.move(at(1, 120 + TOUCH_PAN_THRESHOLD_PX, 80, 100));
    t.fireTimers();
    expect(t.longPresses).not.toHaveBeenCalled();
  });

  it("does not fire after the finger lifts", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 120, 80, 0));
    g.up(at(1, 120, 80, 100));
    t.fireTimers();
    expect(t.longPresses).not.toHaveBeenCalled();
  });

  it("does not fire once a second finger lands", () => {
    // Two fingers is a pinch. A menu opening under one of them would
    // swallow the gesture.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 120, 80, 0));
    g.down(at(2, 220, 80, 30));
    t.fireTimers();
    expect(t.longPresses).not.toHaveBeenCalled();
  });

  it("is not armed for a press the editor owns", () => {
    // The editor times its own long-press for those, and two menus
    // racing on one press is worse than either.
    const t = makeHost({ content: () => true });
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 120, 80, 0));
    t.fireTimers();
    expect(t.longPresses).not.toHaveBeenCalled();
  });

  it("does not also report a tap", () => {
    // A press held past the long-press delay is past the tap window
    // too, so the selection must not clear out from under the menu.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 120, 80, 0));
    t.fireTimers();
    g.up(at(1, 120, 80, 600));
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

describe("board touch gestures — attach", () => {
  /** A container with a scene surface and a piece of chrome inside it. */
  function makeDom() {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    const chrome = document.createElement("div"); // stands in for the minimap
    container.append(canvas, chrome);
    document.body.append(container);
    return { container, canvas, chrome };
  }

  const press = (el: Element) =>
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 10,
        clientY: 10,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      }),
    );

  it("claims a press on the scene surface", () => {
    const t = makeHost();
    const { container, canvas } = makeDom();
    const seen: Event[] = [];
    container.addEventListener("pointerdown", (e) => seen.push(e));
    const detach = attachBoardTouchGestures(container, t.host, {
      isSceneSurface: (target) => target === canvas,
    });
    press(canvas);
    // Stopped in capture, so the bubble listener on the container never
    // sees it — which is how the editor is kept out of the gesture.
    expect(seen).toHaveLength(0);
    detach();
  });

  it("leaves chrome inside the container alone", () => {
    // The minimap lives under the same container and drives its own
    // bubble-phase drag. `hasContentAt` hit-tests the SCENE, so a press
    // over the minimap reads as empty canvas and would otherwise be
    // claimed — taking away the one pan path touch already had.
    const t = makeHost();
    const { container, canvas, chrome } = makeDom();
    const seen: Event[] = [];
    container.addEventListener("pointerdown", (e) => seen.push(e));
    const detach = attachBoardTouchGestures(container, t.host, {
      isSceneSurface: (target) => target === canvas,
    });
    press(chrome);
    expect(seen).toHaveLength(1);
    detach();
  });

  it("ignores a mouse press entirely", () => {
    const t = makeHost();
    const { container, canvas } = makeDom();
    const seen: Event[] = [];
    container.addEventListener("pointerdown", (e) => seen.push(e));
    const detach = attachBoardTouchGestures(container, t.host, {
      isSceneSurface: () => true,
    });
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 10,
        clientY: 10,
        pointerType: "mouse",
        isPrimary: true,
        bubbles: true,
      }),
    );
    expect(seen).toHaveLength(1);
    detach();
  });

  it("disarms a pending long press on teardown", () => {
    // The board passes no timer injection in production, so this would
    // be a live setTimeout firing `onLongPress` into a detached editor
    // over a disposed store.
    const t = makeHost();
    const { container, canvas } = makeDom();
    const detach = attachBoardTouchGestures(container, t.host, {
      isSceneSurface: () => true,
    });
    press(canvas);
    detach();
    t.fireTimers();
    expect(t.longPresses).not.toHaveBeenCalled();
  });
});

describe("board touch gestures — the menu ends the gesture", () => {
  it("does not pan after the menu opened", () => {
    // Hold-then-drag is a natural grab. Without a terminal mode the
    // plane would slide behind the open menu.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    t.fireTimers();
    g.move(at(1, 400, 100, 600));
    expect(t.viewport).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });

  it("does not pinch after the menu opened", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    t.fireTimers();
    g.down(at(2, 200, 100, 600));
    g.move(at(2, 400, 100, 700));
    expect(t.viewport.zoom).toBe(1);
  });

  it("still pans when no menu opened", () => {
    // A read-only mount offers no menu, so the press stays a press —
    // a viewer must not be stranded by holding still for half a second.
    const t = makeHost({ menuOpens: false });
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    t.fireTimers();
    g.move(at(1, 200, 100, 600));
    expect(t.viewport.panX).toBe(100);
  });

  it("frees the gesture once every finger lifts", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    t.fireTimers();
    g.up(at(1, 100, 100, 700));
    g.down(at(1, 100, 100, 800));
    g.move(at(1, 200, 100, 900));
    expect(t.viewport.panX).toBe(100);
  });
});

describe("board touch gestures — bookkeeping across the editor's guard", () => {
  function makeDom() {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    container.append(canvas);
    document.body.append(container);
    return { container, canvas };
  }

  const press = (el: Element, id: number) =>
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: id,
        clientX: 10,
        clientY: 10,
        pointerType: "touch",
        bubbles: true,
      }),
    );
  const release = (el: Element, id: number) =>
    el.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: id,
        clientX: 10,
        clientY: 10,
        pointerType: "touch",
        bubbles: true,
      }),
    );

  it("still sees a release the editor stops at document capture", () => {
    // The editor drops a foreign touch's `pointerup` at `document`
    // capture so a second finger cannot drive the first one's gesture.
    // This layer binds on `window`, which the capture phase reaches
    // first — otherwise that pointer would never leave `active`, and a
    // gesture only ends when `active` drains, so the board would accept
    // no further pan for the life of the mount.
    const t = makeHost({ content: () => true }); // press is conceded
    const { container, canvas } = makeDom();
    const editorGuard = (e: Event) => {
      if ((e as PointerEvent).pointerId !== 1) e.stopPropagation();
    };
    document.addEventListener("pointerup", editorGuard, true);
    const detach = attachBoardTouchGestures(container, t.host, {
      isSceneSurface: () => true,
    });

    press(canvas, 1); // conceded to the editor
    press(canvas, 2); // second finger
    release(canvas, 2); // the editor stops this at document capture
    release(canvas, 1);

    // The gesture drained, so a fresh press on empty canvas is claimed.
    t.host.hasContentAt = () => false;
    expect(t.host.getViewport()).toEqual({ panX: 0, panY: 0, zoom: 1 });
    press(canvas, 3);
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 3,
        clientX: 200,
        clientY: 10,
        pointerType: "touch",
        bubbles: true,
      }),
    );
    expect(t.viewport.panX).toBeGreaterThan(0);

    document.removeEventListener("pointerup", editorGuard, true);
    detach();
  });
});

describe("board touch gestures — extra fingers while the menu is open", () => {
  it("does not reset the gesture while another finger is still down", () => {
    // A pointer swallowed by menu mode is still a pointer that is down.
    // Untracked, the initiating finger's release drains `pointers` to
    // empty and resets — after which a further press starts fresh and
    // pans behind the open menu.
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    t.fireTimers();
    g.down(at(2, 200, 100, 600));
    g.up(at(1, 100, 100, 700));
    // A third finger must not start a pan: the gesture is still the
    // menu's until every finger lifts.
    g.down(at(3, 300, 100, 800));
    g.move(at(3, 500, 100, 900));
    expect(t.viewport).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });

  it("frees the gesture once the last finger lifts", () => {
    const t = makeHost();
    const g = createBoardTouchGestures(t.host);
    g.down(at(1, 100, 100, 0));
    t.fireTimers();
    g.down(at(2, 200, 100, 600));
    g.up(at(1, 100, 100, 700));
    g.up(at(2, 200, 100, 800));
    g.down(at(1, 100, 100, 900));
    g.move(at(1, 200, 100, 1000));
    expect(t.viewport.panX).toBe(100);
  });
});
