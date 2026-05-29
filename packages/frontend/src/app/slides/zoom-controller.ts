/**
 * Session-scoped zoom controller for the slides editor canvas.
 *
 * Lives between `SlidesView` (which scales the host canvas + overlay
 * via `refitCanvas`) and `SlidesToolbar` (which renders the dropdown
 * the user clicks). The controller is plain JS — no React state — so
 * both consumers can subscribe imperatively without one taking a
 * dependency on the other's render cycle.
 *
 * `1.0` is the special baseline labelled "Fit": at 1.0 the canvas
 * tracks the available column size exactly, matching the editor's
 * default before this feature shipped. Values > 1 multiply the fit
 * size; the existing `MAX_HOST_W` clamp in `slides-view.tsx` keeps
 * the painted bitmap from blowing past a 4K width on ultra-wide
 * displays even at 200 %.
 *
 * Per spec (slides-toolbar-tier1.md), zoom is session-only — there
 * is no persistence to Yorkie or localStorage. A new doc mount
 * always starts at Fit (1.0).
 */

export interface ZoomController {
  /** Current zoom factor; 1.0 means "Fit". */
  get(): number;
  /**
   * Set the zoom factor. Clamped to [MIN_ZOOM, MAX_ZOOM]. No-op when
   * the resolved next value equals the current value.
   */
  set(value: number): void;
  /** Subscribe to changes; returns an unsubscribe handle. */
  subscribe(cb: () => void): () => void;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4.0;

/** Discrete zoom presets exposed by the toolbar dropdown. */
export const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.5, 2.0] as const;

/**
 * Pick the next / previous preset relative to `current`. Falls through
 * the unsorted PRESETS via a sorted snapshot so the helper is robust
 * if the constant is ever extended out of order.
 */
export function pickNextPreset(current: number, dir: 1 | -1): number {
  const sorted = [...ZOOM_PRESETS].sort((a, b) => a - b);
  if (dir === 1) {
    return sorted.find((p) => p > current) ?? sorted[sorted.length - 1];
  }
  return [...sorted].reverse().find((p) => p < current) ?? sorted[0];
}

export function createZoomController(initial = 1.0): ZoomController {
  let value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initial));
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
      if (next === value) return;
      value = next;
      for (const cb of listeners) cb();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
