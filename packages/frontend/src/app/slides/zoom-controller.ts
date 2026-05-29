/**
 * Session-scoped zoom controller for the slides editor canvas.
 *
 * Lives between `SlidesView` (which scales the host canvas + overlay
 * via `refitCanvas`) and `SlidesToolbar` (which renders the dropdown
 * the user clicks). The controller is plain JS — no React state — so
 * both consumers can subscribe imperatively without one taking a
 * dependency on the other's render cycle.
 *
 * Fit and absolute zoom are *two different sizing models*:
 *
 *   `FIT_ZOOM` (`0`) — Fit: the host tracks the available column,
 *                     preserving the slide aspect. The "fit to screen"
 *                     mode shown at the top of the toolbar dropdown.
 *
 *   positive number  — Absolute zoom factor. `1.0` means the host is
 *                     the slide's logical 1920 × 1080 CSS px,
 *                     regardless of the column width. `0.5`, `0.75`,
 *                     `1.5`, `2.0` are the standard presets. The
 *                     canvas overflows the column and `SlidesView`
 *                     provides horizontal + vertical scroll.
 *
 * `FIT_ZOOM` is a sentinel rather than `1.0` because users (and Google
 * Slides) treat "Fit to screen" as a distinct option from "100 %" —
 * one is viewport-relative, the other absolute.
 *
 * Per spec (slides-toolbar-tier1.md), zoom is session-only — there is
 * no persistence to Yorkie or localStorage. A new doc mount always
 * starts at Fit.
 */

export interface ZoomController {
  /**
   * Current zoom. Either `FIT_ZOOM` (0) for "fit to column" or a
   * positive number where `1.0` = 100 % of the slide's logical size.
   */
  get(): number;
  /**
   * Set the zoom. `FIT_ZOOM` is preserved as-is; positive numbers are
   * clamped to [MIN_ZOOM, MAX_ZOOM]. No-op when the resolved next value
   * equals the current value.
   */
  set(value: number): void;
  /** Subscribe to changes; returns an unsubscribe handle. */
  subscribe(cb: () => void): () => void;
}

/** Sentinel meaning "fit the host to the available column". */
export const FIT_ZOOM = 0;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4.0;

/** Discrete absolute-zoom presets exposed by the toolbar dropdown below Fit. */
export const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.5, 2.0] as const;

/**
 * Clamp an absolute zoom value into [MIN_ZOOM, MAX_ZOOM]. `FIT_ZOOM`
 * passes through unchanged so the sentinel is never silently lost.
 */
function clampZoom(value: number): number {
  if (value === FIT_ZOOM) return FIT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Pick the next / previous preset relative to `current`. When `current`
 * is `FIT_ZOOM`, behaves as if standing at 100 % (the natural neighbour
 * — Google Slides does the same when stepping out of Fit). Sorted
 * snapshot makes the helper robust to a future ordering change in
 * `ZOOM_PRESETS`.
 */
export function pickNextPreset(current: number, dir: 1 | -1): number {
  const sorted = [...ZOOM_PRESETS].sort((a, b) => a - b);
  const base = current === FIT_ZOOM ? 1.0 : current;
  if (dir === 1) {
    return sorted.find((p) => p > base) ?? sorted[sorted.length - 1];
  }
  return [...sorted].reverse().find((p) => p < base) ?? sorted[0];
}

export function createZoomController(
  initial: number = FIT_ZOOM,
): ZoomController {
  let value = clampZoom(initial);
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      const next = clampZoom(v);
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
