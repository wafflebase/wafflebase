import { panBy, zoomAt, type Viewport } from "@wafflebase/board";
import { dismissContextMenu } from "@wafflebase/slides";

/**
 * Client-px travel above which a one-finger press stops being a tap and
 * becomes a pan. Matches `TOUCH_DRAG_THRESHOLD_PX` in the slides
 * package for the same reason it exists there: a fingertip reports
 * 5–10px of travel across a press the user experienced as stationary.
 */
export const TOUCH_PAN_THRESHOLD_PX = 10;

/** Longest press still read as a tap rather than an aborted pan. */
export const TAP_MAX_DURATION_MS = 400;

/**
 * Held-still duration that opens the context menu. Same number as the
 * editor's own long-press and the spreadsheet's, so the gesture means
 * one thing across the product. The board needs its own copy because it
 * intercepts empty-canvas presses before the editor can time them.
 */
export const LONG_PRESS_DELAY_MS = 500;

/** A press we are tracking, in viewport coordinates. */
export interface GesturePointer {
  id: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export interface BoardGestureHost {
  getViewport(): Viewport;
  /** THE viewport chokepoint — the same one wheel and the minimap use. */
  commit(next: Viewport): void;
  /**
   * Whether a press here lands on something the editor acts on. Decides
   * who owns the gesture: content → the editor moves the element, empty
   * canvas → we pan the plane.
   */
  hasContentAt(clientX: number, clientY: number): boolean;
  /** Viewport → canvas-local CSS px, the space `zoomAt` anchors in. */
  toCanvasPoint(clientX: number, clientY: number): { x: number; y: number };
  /** A tap that landed on empty canvas and never became a pan. */
  onEmptyTap(): void;
  /**
   * A press held still on empty canvas. The editor times its own
   * long-press, but never sees these — we claimed them — so the board
   * has to open the canvas menu itself or it becomes unreachable by
   * finger.
   */
  onLongPress(clientX: number, clientY: number): void;
  /** Zoom changed; the toolbar readout follows. Not called on a pure pan. */
  onZoomChange(zoom: number): void;
  /**
   * Schedules `fn` after `ms` and returns a cancel function. Injected so
   * the gesture's timing is drivable from a test without fake timers.
   */
  setTimer?(fn: () => void, ms: number): () => void;
}

type Mode = "idle" | "pending" | "pan" | "pinch";

interface Tracked {
  x: number;
  y: number;
}

function distance(a: Tracked, b: Tracked): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Tracked, b: Tracked): Tracked {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Touch navigation for the board plane.
 *
 * Before this, a board could not be moved by a finger at all: pan was
 * space-drag, middle-drag, or wheel — a keyboard, a third mouse button,
 * and an event touch does not generate — and the host's
 * `touch-action: none` also denied the browser its own pan. On an
 * unbounded plane that leaves the content wherever it happens to sit.
 *
 * Ownership is decided at press time by what is under the finger,
 * which is the Miro / FigJam convention and the one thing
 * `touch-action` cannot express:
 *
 * - **Empty canvas** → ours. One finger pans, a second finger adds
 *   pinch zoom about the gesture midpoint. The press never reaches the
 *   editor, so a pan never also draws a lasso.
 * - **An element or a selection handle** → the editor's, untouched. The
 *   finger moves / resizes it exactly as a mouse would.
 *
 * The consequence of deciding at press time is that a pinch beginning
 * with a finger on an element is not a pinch — that gesture is already
 * an element drag, and there is no way to retract it from the editor
 * once its drag loop owns the pointer stream. Lifting and pinching on
 * empty canvas zooms. This is deliberate: the alternative is to delay
 * every touch drag by a pinch-detection window, which taxes the common
 * gesture to serve the rare one.
 */
export function createBoardTouchGestures(host: BoardGestureHost) {
  /**
   * Every touch currently down, ours or not. Ownership is decided once
   * per gesture — when this goes from empty to one — and a gesture is
   * over only when it drains back to empty. Without this second set, a
   * conceded press (a finger on an element) leaves `pointers` empty, so
   * a second finger landing on blank canvas would read as the start of
   * a fresh gesture and pan the plane out from under an element drag.
   */
  const active = new Set<number>();
  const pointers = new Map<number, Tracked>();
  /** Whether we claimed the current gesture. */
  let owned = false;
  let mode: Mode = "idle";
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  /** Last position of the single tracked pointer, for pan deltas. */
  let lastX = 0;
  let lastY = 0;
  /** Pinch reference, refreshed every frame so zoom is incremental. */
  let lastPinchDist = 0;
  let lastPinchMid: Tracked = { x: 0, y: 0 };
  let cancelLongPress: (() => void) | null = null;

  const schedule =
    host.setTimer ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });

  const disarmLongPress = (): void => {
    cancelLongPress?.();
    cancelLongPress = null;
  };

  const reset = (): void => {
    disarmLongPress();
    active.clear();
    pointers.clear();
    owned = false;
    mode = "idle";
  };

  /** The two pointers a pinch is measured between, in insertion order. */
  const pinchPair = (): [Tracked, Tracked] | null => {
    const it = pointers.values();
    const a = it.next();
    const b = it.next();
    if (a.done || b.done) return null;
    return [a.value, b.value];
  };

  const beginPinch = (): void => {
    const pair = pinchPair();
    if (!pair) return;
    mode = "pinch";
    lastPinchDist = distance(pair[0], pair[1]);
    lastPinchMid = midpoint(pair[0], pair[1]);
  };

  /**
   * Handle a press. Returns true when we claimed it, which the DOM
   * adapter turns into `stopPropagation()` so the editor never sees it.
   */
  const down = (p: GesturePointer): boolean => {
    const isFirst = active.size === 0;
    active.add(p.id);
    if (isFirst) {
      owned = !host.hasContentAt(p.clientX, p.clientY);
      if (!owned) {
        mode = "idle";
        return false;
      }
      pointers.set(p.id, { x: p.clientX, y: p.clientY });
      mode = "pending";
      startX = p.clientX;
      startY = p.clientY;
      startTime = p.timeStamp;
      lastX = p.clientX;
      lastY = p.clientY;
      cancelLongPress = schedule(() => {
        cancelLongPress = null;
        // Only a press that never became anything else. `mode` is still
        // `pending` exactly when the finger has stayed inside the pan
        // threshold, which is the same "held still" the editor's own
        // long-press requires.
        if (mode === "pending") host.onLongPress(startX, startY);
      }, LONG_PRESS_DELAY_MS);
      return true;
    }
    if (!owned) return false;
    // A second finger is a pinch, not a menu.
    disarmLongPress();
    pointers.set(p.id, { x: p.clientX, y: p.clientY });
    if (pointers.size >= 2) beginPinch();
    return true;
  };

  const move = (p: GesturePointer): void => {
    if (!owned) return;
    const tracked = pointers.get(p.id);
    if (!tracked) return;
    tracked.x = p.clientX;
    tracked.y = p.clientY;

    if (mode === "pinch") {
      const pair = pinchPair();
      if (!pair) return;
      const dist = distance(pair[0], pair[1]);
      const mid = midpoint(pair[0], pair[1]);
      // Guard the degenerate case: two fingers landing on the same
      // point makes `lastPinchDist` zero and the factor infinite.
      const factor = lastPinchDist > 0 ? dist / lastPinchDist : 1;
      const anchor = host.toCanvasPoint(lastPinchMid.x, lastPinchMid.y);
      // Scale about where the fingers were, then translate by how far
      // their midpoint travelled — the standard two-finger formulation,
      // so a pinch that also slides pans and zooms in one gesture.
      const before = host.getViewport();
      const next = panBy(
        zoomAt(before, anchor, factor),
        mid.x - lastPinchMid.x,
        mid.y - lastPinchMid.y,
      );
      lastPinchDist = dist;
      lastPinchMid = mid;
      host.commit(next);
      // Compared against the viewport we started from, so a pinch held
      // at the zoom clamp reports nothing rather than re-announcing the
      // same value every frame.
      if (next.zoom !== before.zoom) host.onZoomChange(next.zoom);
      return;
    }

    if (pointers.size !== 1) return;
    if (mode === "pending") {
      const travelled = Math.hypot(p.clientX - startX, p.clientY - startY);
      if (travelled < TOUCH_PAN_THRESHOLD_PX) return;
      // Moving past the threshold makes this a pan, so the pending menu
      // must not fire under the finger mid-drag.
      disarmLongPress();
      mode = "pan";
      // Pan from the press point, not from where the threshold was
      // crossed, so the content does not jump by the threshold on the
      // first frame.
      lastX = startX;
      lastY = startY;
    }
    if (mode !== "pan") return;
    host.commit(panBy(host.getViewport(), p.clientX - lastX, p.clientY - lastY));
    lastX = p.clientX;
    lastY = p.clientY;
  };

  const up = (p: GesturePointer): void => {
    active.delete(p.id);
    if (!owned) {
      // A conceded gesture still has to be seen to its end, or the next
      // press would be read as its continuation.
      if (active.size === 0) reset();
      return;
    }
    if (!pointers.delete(p.id)) return;

    if (pointers.size === 0) {
      const travelled = Math.hypot(p.clientX - startX, p.clientY - startY);
      const isTap =
        mode === "pending" &&
        travelled < TOUCH_PAN_THRESHOLD_PX &&
        p.timeStamp - startTime < TAP_MAX_DURATION_MS;
      reset();
      // Deselect-on-tap. The editor would normally do this through its
      // empty-canvas lasso path, which our claim above intercepted, so
      // the host has to be told the tap happened.
      if (isTap) host.onEmptyTap();
      return;
    }

    if (pointers.size === 1) {
      // A pinch losing one finger continues as a pan under the finger
      // still down, rather than freezing until the user lifts and
      // presses again.
      const [remaining] = pointers.values();
      mode = "pan";
      lastX = remaining.x;
      lastY = remaining.y;
      return;
    }

    // Three or more fingers were down and one lifted; re-seed the pinch
    // against whichever two remain.
    beginPinch();
  };

  const cancel = (p: GesturePointer): void => {
    active.delete(p.id);
    if (!owned) {
      if (active.size === 0) reset();
      return;
    }
    if (!pointers.delete(p.id)) return;
    // A cancelled pointer is not a tap — the platform took the gesture
    // away (a system edge swipe, the page being scrolled by a parent).
    if (pointers.size === 0) reset();
    else if (pointers.size === 1) {
      const [remaining] = pointers.values();
      mode = "pan";
      lastX = remaining.x;
      lastY = remaining.y;
    } else beginPinch();
  };

  return { down, move, up, cancel, reset };
}

export type BoardTouchGestures = ReturnType<typeof createBoardTouchGestures>;

export interface BoardTouchAttachOptions {
  /**
   * Whether an event target is part of the board's drawing surface —
   * the canvas or the selection overlay — as opposed to the chrome the
   * host also parents under the same container (the minimap and its
   * toggle). Only presses on the surface are candidates for the
   * gesture; everything else keeps its own handlers.
   */
  isSceneSurface(target: EventTarget | null): boolean;
}

/**
 * DOM adapter for {@link createBoardTouchGestures}. Everything is bound
 * in the CAPTURE phase on `container`, an ancestor of both the editor's
 * canvas and its overlay, so a claimed press is halted before the
 * editor's own same-element listeners run — the identical reason the
 * space / middle-drag pan in `board-view.tsx` binds where it does.
 *
 * Returns the teardown.
 */
export function attachBoardTouchGestures(
  container: HTMLElement,
  host: BoardGestureHost,
  options: BoardTouchAttachOptions,
): () => void {
  const gestures = createBoardTouchGestures(host);

  const read = (e: PointerEvent): GesturePointer => ({
    id: e.pointerId,
    clientX: e.clientX,
    clientY: e.clientY,
    timeStamp: e.timeStamp,
  });

  const onDown = (e: PointerEvent): void => {
    // Mouse and stylus keep every existing path: the wheel, the
    // space/middle-drag pan, lasso select, element drag. This layer is
    // only about the input that had no way to navigate at all.
    if (e.pointerType !== "touch") return;
    // `container` holds more than the scene: the minimap and its toggle
    // are children of it too. Ownership is otherwise decided by
    // `hasContentAt`, which hit-tests the SCENE and knows nothing about
    // DOM chrome floating above it — so a press on the minimap, where
    // no element happens to sit behind it, would read as empty canvas,
    // be claimed, and pan the board instead of navigating. Worse, the
    // outcome would depend on what the minimap happens to be covering.
    if (!options.isSceneSurface(e.target)) return;
    if (!gestures.down(read(e))) return;
    // Claiming means `stopPropagation`, which halts the event before it
    // reaches the descendants AND before it bubbles back to `document`
    // — where the context menu's own outside-press dismissal listens.
    // So a tap meant to close an open menu would leave it open, on a
    // device with no Escape key. Close it here instead.
    dismissContextMenu();
    e.stopPropagation();
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") return;
    gestures.move(read(e));
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") return;
    gestures.up(read(e));
  };
  const onCancel = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") return;
    gestures.cancel(read(e));
  };

  const opts = { capture: true } as const;
  container.addEventListener("pointerdown", onDown as EventListener, opts);
  container.addEventListener("pointermove", onMove as EventListener, opts);
  container.addEventListener("pointerup", onUp as EventListener, opts);
  container.addEventListener("pointercancel", onCancel as EventListener, opts);

  return () => {
    // Before the listeners, and load-bearing: a press still being timed
    // for a long-press holds a live `setTimeout`. Left armed, it fires
    // after the mount effect has torn the editor down and disposed the
    // store, and `onLongPress` reads both.
    gestures.reset();
    container.removeEventListener("pointerdown", onDown as EventListener, opts);
    container.removeEventListener("pointermove", onMove as EventListener, opts);
    container.removeEventListener("pointerup", onUp as EventListener, opts);
    container.removeEventListener(
      "pointercancel",
      onCancel as EventListener,
      opts,
    );
  };
}
