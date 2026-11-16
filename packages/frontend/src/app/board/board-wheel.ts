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
  /**
   * `WheelEvent.deltaMode`: 0 pixels (default), 1 lines, 2 pages.
   * Firefox reports mouse wheels in lines, so an unscaled delta of 3
   * would pan the board by 3 px per notch.
   */
  deltaMode?: number;
  /** Shift held — a vertical wheel then pans horizontally. */
  shiftKey?: boolean;
  /** Host size in CSS px; one "page" of a `deltaMode === 2` delta. */
  pageWidth?: number;
  pageHeight?: number;
  /** Cursor position in canvas-local CSS px — the zoom anchor. */
  offsetX: number;
  offsetY: number;
}

/** CSS px per wheel "line" — the conventional browser line height. */
const LINE_PX = 16;

/**
 * Zoom per pixel of wheel delta: `factor = exp(-Δ · ZOOM_PER_PX)`.
 *
 * Continuous in Δ because a trackpad pinch arrives as a stream of small
 * ctrl+wheel events (Δ ≈ 1–5 each). A fixed step per event made a pinch
 * jump 10% per event — far too fast and visibly stepped.
 */
const ZOOM_PER_PX = 0.01;

/**
 * Per-event |Δ| ceiling for zoom. A mouse-wheel notch reports Δ ≈ 100
 * (or 3 lines), which unclamped would zoom ~2.7× per notch; at the
 * ceiling a notch is exp(0.1) ≈ 10.5%, the step the board always had.
 */
const MAX_ZOOM_DELTA_PX = 10;

/** A wheel delta in CSS px, whatever unit the event reported it in. */
function toPixels(delta: number, mode: number | undefined, page: number | undefined): number {
  if (mode === 1) return delta * LINE_PX;
  if (mode === 2) return delta * (page ?? 800);
  return delta;
}

/**
 * Board wheel → viewport mapping, extracted from the pointer-event
 * wiring in `board-view.tsx` so it is unit-testable without a DOM.
 *
 * - Ctrl/Cmd + wheel: zoom about the cursor (screen-anchored — the world
 *   point under the cursor stays fixed), in on `deltaY < 0` (scroll up /
 *   pinch out), out otherwise; continuous in the delta (see
 *   {@link ZOOM_PER_PX}).
 * - Plain wheel: pan, inverted (`-deltaX`/`-deltaY`) so content follows
 *   the gesture direction — a two-finger scroll down moves the visible
 *   plane down, matching every other infinite-canvas tool.
 * - Shift + a purely vertical wheel: pan horizontally. macOS already
 *   swaps the axes for Shift, which arrives here with `deltaX` set and
 *   is left alone.
 */
export function applyWheelToViewport(vp: Viewport, e: WheelInput): Viewport {
  let dx = toPixels(e.deltaX, e.deltaMode, e.pageWidth);
  let dy = toPixels(e.deltaY, e.deltaMode, e.pageHeight);
  if (e.ctrlKey || e.metaKey) {
    const d = Math.max(-MAX_ZOOM_DELTA_PX, Math.min(MAX_ZOOM_DELTA_PX, dy));
    return zoomAt(vp, { x: e.offsetX, y: e.offsetY }, Math.exp(-d * ZOOM_PER_PX));
  }
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return panBy(vp, -dx, -dy);
}
