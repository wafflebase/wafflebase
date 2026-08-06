import type { Frame } from "@wafflebase/slides";
import { zoomAt, type Viewport } from "@wafflebase/board";
import { FIT_ZOOM, type ZoomController } from "../slides/zoom-controller";
import { fitViewportToScene } from "./fit-to-content";
import { sceneBounds } from "./minimap-geometry";

/**
 * The board's own zoom range — the defaults `zoomAt` clamps to in
 * `@wafflebase/board`'s viewport module. Deliberately wider than slides'
 * [0.25, 4]: an infinite plane is routinely surveyed further out and
 * inspected further in than a single slide.
 */
export const BOARD_MIN_ZOOM = 0.1;
export const BOARD_MAX_ZOOM = 8;

function clamp(value: number): number {
  if (value === FIT_ZOOM) return FIT_ZOOM;
  return Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, value));
}

/**
 * Board zoom controller, satisfying the same {@link ZoomController}
 * interface `ZoomControl` renders against so the slides dropdown is
 * reused unchanged.
 *
 * Board-local rather than slides' `createZoomController` purely because
 * of the clamp: that factory pins values into [0.25, 4], which would
 * clip the wheel-zoom write-back below 0.25 or above 4 and leave the
 * dropdown reporting a scale the canvas is not at.
 *
 * The controller is an intent/label channel, never a second copy of the
 * scale — the viewport in `BoardView` stays the single source of truth.
 * Session-only, like the slides controller: no Yorkie, no localStorage.
 */
export function createBoardZoomController(
  initial: number = FIT_ZOOM,
): ZoomController {
  let value = clamp(initial);
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      const next = clamp(v);
      if (next === value) return;
      value = next;
      for (const cb of listeners) cb();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Resolve a controller value into the viewport to commit.
 *
 * - `FIT_ZOOM` frames every element (the repeatable form of the board's
 *   open-time fit — `createFitToContentOnce` is a one-shot latch and
 *   must not be reused here).
 * - A preset zooms about the HOST CENTRE, so the content the user is
 *   looking at stays put instead of sliding toward a corner.
 *
 * `undefined` means "nothing to commit": an empty scene on FIT, or a
 * host with no area yet. Callers must treat it as a no-op, never as a
 * viewport reset.
 */
export function applyZoomValue(
  vp: Viewport,
  value: number,
  host: { w: number; h: number },
  frames: Frame[],
): Viewport | undefined {
  if (!(host.w > 0) || !(host.h > 0)) return undefined;
  if (value === FIT_ZOOM) {
    return fitViewportToScene(sceneBounds(frames), host);
  }
  const target = clamp(value);
  // zoomAt takes a multiplicative factor; convert the absolute target.
  return zoomAt(
    vp,
    { x: host.w / 2, y: host.h / 2 },
    target / vp.zoom,
    BOARD_MIN_ZOOM,
    BOARD_MAX_ZOOM,
  );
}
