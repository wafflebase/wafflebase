import { panBy, zoomAt, type Viewport } from "@wafflebase/board";

/**
 * Minimal `WheelEvent` shape consumed by {@link applyWheelToViewport} —
 * decoupled from the DOM type so the pure mapping is unit-testable
 * without constructing a real `WheelEvent` (jsdom's `WheelEvent` doesn't
 * reliably populate `offsetX`/`offsetY` anyway).
 */
export interface WheelInput {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
  /** Cursor position in canvas-local CSS px — the zoom anchor. */
  offsetX: number;
  offsetY: number;
}

/** Multiplicative zoom step per wheel tick (10%), matching Figma/Slides feel. */
const ZOOM_STEP = 1.1;

/**
 * Board wheel → viewport mapping, extracted from the pointer-event
 * wiring in `board-view.tsx` so it is unit-testable without a DOM.
 *
 * - Ctrl/Cmd + wheel: zoom about the cursor (screen-anchored — the world
 *   point under the cursor stays fixed), in on `deltaY < 0` (scroll up /
 *   pinch out), out otherwise.
 * - Plain wheel: pan, inverted (`-deltaX`/`-deltaY`) so content follows
 *   the gesture direction — a two-finger scroll down moves the visible
 *   plane down, matching every other infinite-canvas tool.
 */
export function applyWheelToViewport(vp: Viewport, e: WheelInput): Viewport {
  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    return zoomAt(vp, { x: e.offsetX, y: e.offsetY }, factor);
  }
  return panBy(vp, -e.deltaX, -e.deltaY);
}
