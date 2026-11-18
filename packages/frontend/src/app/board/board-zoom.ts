import type { Frame } from "@wafflebase/slides";
import { zoomAt, type Viewport } from "@wafflebase/board";
import { FIT_ZOOM, type ZoomController } from "../slides/zoom-controller";
import { MAX_FIT_ZOOM, fitViewportToScene } from "./fit-to-content";
import type { FitInsets } from "./fit-insets";
import { sceneBounds } from "./minimap-geometry";

/**
 * The board's own zoom range — the defaults `zoomAt` clamps to in
 * `@wafflebase/board`'s viewport module. Deliberately wider than slides'
 * [0.25, 4]: an infinite plane is routinely surveyed further out and
 * inspected further in than a single slide.
 */
export const BOARD_MIN_ZOOM = 0.1;
export const BOARD_MAX_ZOOM = 8;

/**
 * The board zoom dropdown's presets. An infinite canvas spends much of its
 * time zoomed out over a whole map, so the list reaches down to 10% (the
 * wheel's floor) instead of stopping at the slides list's 50%, and up
 * to the 8× ceiling the wheel can already reach.
 */
export const BOARD_ZOOM_PRESETS = [0.1, 0.25, 0.5, 1, 2, 4, 8] as const;

/**
 * Ceiling for zoom-to-selection (Shift+2). Higher than the whole-board
 * fit's 1:1 because the user asked to look closely at what they picked,
 * but not the full 8×, where one small sticky reads as a blur.
 */
export const SELECTION_FIT_MAX_ZOOM = 2;

/**
 * The zoom `Mod+=` / `Mod+-` steps to: the next preset strictly past
 * `current` in `direction`, so a wheel-zoomed 137% steps in to 200% and
 * out to 100% instead of drifting by a fixed factor. Clamped at the ends.
 */
export function stepZoomPreset(current: number, direction: 1 | -1): number {
  const eps = 1e-6;
  if (direction > 0) {
    return BOARD_ZOOM_PRESETS.find((z) => z > current + eps) ?? BOARD_MAX_ZOOM;
  }
  for (let i = BOARD_ZOOM_PRESETS.length - 1; i >= 0; i--) {
    if (BOARD_ZOOM_PRESETS[i] < current - eps) return BOARD_ZOOM_PRESETS[i];
  }
  return BOARD_MIN_ZOOM;
}

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
  insets?: FitInsets,
): Viewport | undefined {
  if (!(host.w > 0) || !(host.h > 0)) return undefined;
  if (value === FIT_ZOOM) {
    return fitViewportToScene(sceneBounds(frames), host, MAX_FIT_ZOOM, insets);
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

export interface BoardZoomBindingOptions {
  /** The live viewport — the single source of truth for scale. */
  getViewport: () => Viewport;
  getHost: () => { w: number; h: number };
  /** Element frames, read only when a fit has to be resolved. */
  getFrames: () => Frame[];
  /** Commit a resolved viewport (viewport + editor + minimap). */
  commit: (next: Viewport) => void;
  /** Chrome floating over the host that a fit keeps content out of. */
  getInsets?: () => FitInsets;
}

export interface BoardZoomBinding {
  /** Hand this to `ZoomControl`; it renders and drives the dropdown. */
  controller: ZoomController;
  /**
   * Re-frame every element now, AND move the readout to "Fit". This is
   * the context menu's "Fit to content": it must leave the dropdown
   * label agreeing with what the viewport just did, exactly as picking
   * Fit from the dropdown does — otherwise a board at 200 % re-frames
   * while the dropdown still claims 200 %.
   */
  fit: () => void;
  /**
   * Report a scale the VIEWPORT already applied (wheel / pinch), so the
   * dropdown label tracks it. Label-only: it never commits a viewport.
   */
  reportViewportZoom: (zoom: number) => void;
  /**
   * Tell the binding a viewport was committed, by any path. While the
   * readout says "Fit", a viewport other than the one the fit produced
   * (a pan, the minimap, a find jump) means the board is no longer
   * fitted, so the readout moves to the percentage. Label-only.
   */
  noteViewport: (vp: Viewport) => void;
  /**
   * Record `vp` as a fit the binding did not run itself (the open-time
   * latch), so committing it does not read as leaving Fit.
   */
  markFitted: (vp: Viewport) => void;
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  const eps = 1e-6;
  return (
    Math.abs(a.zoom - b.zoom) < eps &&
    Math.abs(a.panX - b.panX) < eps &&
    Math.abs(a.panY - b.panY) < eps
  );
}

/**
 * Bind a board zoom {@link ZoomController} to the viewport it drives.
 *
 * The controller alone is a value holder, and its `set` deliberately
 * early-returns when the value is unchanged. That is right for slides,
 * where Fit is an idempotent sizing MODE, but wrong for a board, where
 * Fit is an ACTION: "re-frame the content now". A board sits at
 * `FIT_ZOOM` by default and returns to it after every fit, so routing
 * Fit through the value channel would make the menu item a no-op in
 * exactly the state users meet it in (pan gestures never change the
 * value either, so it would stay dead).
 *
 * So this binding treats the two dropdown branches differently:
 *
 * - **Fit** — always executes {@link BoardZoomBinding.fit}, regardless
 *   of the stored value. The value is still set (the label reads "Fit").
 * - **A preset** — resolved about the host centre and committed.
 *
 * Applying happens HERE, on the intent, rather than in a `subscribe`
 * callback, so a value written for labelling alone
 * ({@link BoardZoomBinding.reportViewportZoom}) cannot re-enter the
 * commit path and re-anchor a zoom the viewport already owns. The
 * controller therefore stays a pure intent/label channel and never
 * becomes a second copy of the scale.
 */
export function createBoardZoomBinding(
  controller: ZoomController,
  opts: BoardZoomBindingOptions,
): BoardZoomBinding {
  // The ACTION half of a fit: resolve + commit, no label write. Split
  // out so the dropdown branch below (which has already written the
  // value) does not write it a second time.
  // The viewport the last fit produced. While the value is FIT_ZOOM, any
  // other committed viewport means the user has moved off the fit.
  let fitted: Viewport | null = null;
  const applyFit = () => {
    const next = applyZoomValue(
      opts.getViewport(),
      FIT_ZOOM,
      opts.getHost(),
      opts.getFrames(),
      opts.getInsets?.(),
    );
    // `undefined` means "nothing to commit" (empty scene / unsized
    // host) — leave the viewport where the user put it.
    if (!next) return;
    // Recorded BEFORE the commit, which reports back via `noteViewport`.
    fitted = next;
    opts.commit(next);
  };

  return {
    markFitted: (vp) => {
      fitted = vp;
    },
    noteViewport: (vp) => {
      if (controller.get() !== FIT_ZOOM) return;
      if (fitted && sameViewport(vp, fitted)) return;
      fitted = null;
      controller.set(vp.zoom);
    },
    // Label + action, for callers that did not come through the dropdown
    // (the canvas context menu's "Fit to content").
    fit: () => {
      controller.set(FIT_ZOOM);
      applyFit();
    },
    reportViewportZoom: (zoom) => controller.set(zoom),
    controller: {
      get: () => controller.get(),
      subscribe: (cb) => controller.subscribe(cb),
      set: (value) => {
        controller.set(value);
        if (value === FIT_ZOOM) {
          applyFit();
          return;
        }
        // The preset branch of `applyZoomValue` reads no frames, so the
        // scene read is skipped rather than computed and discarded.
        const next = applyZoomValue(
          opts.getViewport(),
          value,
          opts.getHost(),
          [],
        );
        if (next) opts.commit(next);
      },
    },
  };
}

/**
 * The viewport Shift+2 commits: the selected top-level elements framed in
 * the host, up to {@link SELECTION_FIT_MAX_ZOOM}. `undefined` when no
 * selected id is a top-level element (nothing selected, or a member
 * selected inside a drilled-into group, whose frame is group-local and
 * would frame the wrong place) or when the host has no area yet.
 */
export function selectionFitViewport(
  elements: ReadonlyArray<{ id: string; frame: Frame }>,
  selectedIds: ReadonlyArray<string>,
  host: { w: number; h: number },
  insets?: FitInsets,
): Viewport | undefined {
  const ids = new Set(selectedIds);
  if (ids.size === 0) return undefined;
  const frames = elements.filter((e) => ids.has(e.id)).map((e) => e.frame);
  return fitViewportToScene(sceneBounds(frames), host, SELECTION_FIT_MAX_ZOOM, insets);
}
