import {
  type Point,
  type Frame,
  type Viewport,
  combinedBoundingBox,
  screenToWorld,
} from '@wafflebase/slides';

export type MiniRect = { x: number; y: number; w: number; h: number };
export type MiniFit = { scale: number; offsetX: number; offsetY: number };

/**
 * World AABB enclosing every element frame, padded by `pad` world px on
 * each side. Undefined when there are no frames (empty board → no
 * minimap content). Uses the rotation-aware `combinedBoundingBox`.
 */
export function sceneBounds(frames: Frame[], pad = 0): MiniRect | undefined {
  const box = combinedBoundingBox(frames);
  if (!box) return undefined;
  return { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
}

/**
 * Uniform fit of a world `bounds` rect into a `mini` px box, letterboxed
 * (aspect-preserving) and centered. `scale` is world px → minimap px.
 */
export function fitScene(bounds: MiniRect, mini: { w: number; h: number }): MiniFit {
  const scale = Math.min(mini.w / bounds.w, mini.h / bounds.h);
  const drawnW = bounds.w * scale;
  const drawnH = bounds.h * scale;
  // Offset places world `bounds.{x,y}` origin, then centers the drawn
  // content within the minimap box.
  return {
    scale,
    offsetX: (mini.w - drawnW) / 2 - bounds.x * scale,
    offsetY: (mini.h - drawnH) / 2 - bounds.y * scale,
  };
}

export function worldToMini(fit: MiniFit, p: Point): Point {
  return { x: p.x * fit.scale + fit.offsetX, y: p.y * fit.scale + fit.offsetY };
}

export function miniToWorld(fit: MiniFit, p: Point): Point {
  return { x: (p.x - fit.offsetX) / fit.scale, y: (p.y - fit.offsetY) / fit.scale };
}

/**
 * The current on-screen world rectangle (what the board viewport shows),
 * mapped into minimap px. Corners come from `screenToWorld` of the two
 * host corners, so it tracks live pan/zoom.
 */
export function viewportRectInMini(
  vp: Viewport,
  host: { w: number; h: number },
  fit: MiniFit,
): MiniRect {
  const tl = worldToMini(fit, screenToWorld(vp, { x: 0, y: 0 }));
  const br = worldToMini(fit, screenToWorld(vp, { x: host.w, y: host.h }));
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/**
 * A viewport that keeps `zoom` but pans so `world` sits at the host
 * center (used when the user drags/clicks in the minimap to navigate).
 */
export function centerViewportOnWorld(
  vp: Viewport,
  world: Point,
  host: { w: number; h: number },
): Viewport {
  return {
    zoom: vp.zoom,
    panX: host.w / 2 - world.x * vp.zoom,
    panY: host.h / 2 - world.y * vp.zoom,
  };
}
