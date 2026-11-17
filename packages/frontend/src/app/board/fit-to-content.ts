import type { Frame, Viewport } from "@wafflebase/slides";
import {
  sceneBounds,
  fitScene,
  type MiniRect,
} from "./minimap-geometry";
import { NO_INSETS, type FitInsets } from "./fit-insets";

/**
 * Fraction of the host the fitted content is allowed to occupy; the remainder
 * is breathing room so elements aren't flush against the window edges.
 *
 * Expressed as a fraction of the HOST rather than as world-px padding (which
 * is what the minimap uses) because the board plane is unbounded: a fixed
 * world-px pad is a huge margin around one sticky note and invisible around a
 * 20k-px board. A host fraction gives the same visual margin at every scale.
 */
export const FIT_CONTENT_FRACTION = 0.92;

/**
 * Never magnify past 1:1 when framing content. Without this a board holding a
 * single small sticky would open at ~40x, which reads as a corrupted document
 * rather than as a zoomed one.
 */
export const MAX_FIT_ZOOM = 1;

/** Matches the floor `zoomAt` clamps to, so the fit can't start out-of-range. */
export const MIN_FIT_ZOOM = 0.1;

/**
 * Viewport that frames `bounds` in a `host`-sized window: the scene's centre
 * lands at the host centre, at the largest zoom that fits (clamped to
 * [{@link MIN_FIT_ZOOM}, `maxZoom`], {@link MAX_FIT_ZOOM} by default —
 * zoom-to-selection passes a higher ceiling, since magnifying the thing
 * the user picked is the point of it).
 *
 * Undefined when there is nothing to frame — an empty scene (`sceneBounds`
 * returned undefined) or a host with no area yet. The caller must treat that
 * as "not fitted", NOT as "fitted to nothing".
 *
 * Pure: `bounds` + `host` in, `Viewport` out — no DOM, no store.
 */
export function fitViewportToScene(
  bounds: MiniRect | undefined,
  host: { w: number; h: number },
  maxZoom: number = MAX_FIT_ZOOM,
  insets: FitInsets = NO_INSETS,
): Viewport | undefined {
  if (!bounds) return undefined;
  if (!(host.w > 0) || !(host.h > 0)) return undefined;

  // The box content may occupy: the host less the chrome floating over it
  // (`insets`, e.g. the minimap's corner). Falls back to the whole host
  // when the insets would leave nothing.
  const boxW = host.w - insets.left - insets.right;
  const boxH = host.h - insets.top - insets.bottom;
  const box =
    boxW > 0 && boxH > 0
      ? { x: insets.left, y: insets.top, w: boxW, h: boxH }
      : { x: 0, y: 0, w: host.w, h: host.h };

  // Fit into a margin-shrunk box, then center in the FULL box: the margin
  // is what produces the breathing room, and centering is unaffected by it.
  const { scale } = fitScene(bounds, {
    w: box.w * FIT_CONTENT_FRACTION,
    h: box.h * FIT_CONTENT_FRACTION,
  });
  // A zero-extent scene (one degenerate frame) makes `scale` Infinity; treat
  // that as "no reason to zoom out" rather than letting a non-finite zoom
  // reach the renderer.
  const wanted = Number.isFinite(scale) ? scale : maxZoom;
  const zoom = Math.min(maxZoom, Math.max(MIN_FIT_ZOOM, wanted));

  const centre = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  return {
    zoom,
    panX: box.x + box.w / 2 - centre.x * zoom,
    panY: box.y + box.h / 2 - centre.y * zoom,
  };
}

/**
 * One-shot latch. Held by the CALLER (a ref in `BoardView`) rather than
 * captured in the closure below, so it survives the mount effect re-running —
 * e.g. when `workspaceId` resolves a moment after the first render. A latch
 * that reset with the effect would re-frame the board and yank a viewport the
 * user had already panned.
 */
export interface FitLatch {
  done: boolean;
}

export interface FitToContentDeps {
  latch: FitLatch;
  /** Element frames of the (single) board plane, read fresh on every attempt. */
  getFrames: () => Frame[];
  getHostSize: () => { w: number; h: number };
  /** Chrome floating over the host that the fit must keep content out of. */
  getInsets?: () => FitInsets;
  /** Commit the framed viewport (assign the ref, push to editor + minimap). */
  apply: (vp: Viewport) => void;
}

/**
 * Build the "frame the board's content, exactly once" callback.
 *
 * Boards live far from the world origin (Miro coordinates especially), so
 * opening at `DEFAULT_VIEWPORT` shows a magnified empty corner and the user
 * has to hunt for their own content.
 *
 * The timing is the whole reason this is a latch and not a one-liner at mount:
 * the Yorkie document usually has NOT synced when the mount effect runs, so the
 * scene is empty and there is nothing to frame. The returned callback is
 * therefore called both at mount and from `store.onChange`, and fits on the
 * first attempt that finds content. An empty scene leaves the latch open so a
 * later sync still gets its chance; once it fires, every later attempt is a
 * cheap early return — a remote peer's edit must never re-frame the board under
 * a user who has since panned away.
 */
export function createFitToContentOnce(deps: FitToContentDeps): () => void {
  return () => {
    if (deps.latch.done) return;
    const vp = fitViewportToScene(
      sceneBounds(deps.getFrames()),
      deps.getHostSize(),
      MAX_FIT_ZOOM,
      deps.getInsets?.(),
    );
    if (!vp) return;
    deps.latch.done = true;
    deps.apply(vp);
  };
}
