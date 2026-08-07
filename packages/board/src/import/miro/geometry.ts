import type { Frame } from '@wafflebase/slides';

/**
 * Miro position (item CENTER) and geometry (rotation in DEGREES).
 *
 * `relativeTo` is what the coordinates are measured against: `canvas_center`
 * for a top-level item, `parent_top_left` for one that lives inside a frame.
 * See `resolveMiroFrames`.
 */
export interface MiroPositionLike { x?: number; y?: number; relativeTo?: string }
export interface MiroGeometryLike { width?: number; height?: number; rotation?: number }
export interface MiroParentLike { id?: string }

/** The least an item must expose for its board frame to be resolved. */
export interface MiroFramedLike {
  id: string;
  position?: MiroPositionLike;
  geometry?: MiroGeometryLike;
  parent?: MiroParentLike;
}

const DEFAULT_SIZE = { w: 100, h: 100 };

/**
 * Convert Miro's center-origin position + degree rotation into the board's
 * top-left-origin `Frame` in radians. Coordinates map 1:1 — the board plane is
 * unbounded, so no scaling is needed.
 *
 * The result is in whatever space `position` was expressed in; use
 * `resolveMiroFrames` to get board-absolute frames.
 */
export function miroFrame(
  position: MiroPositionLike | undefined,
  geometry: MiroGeometryLike | undefined,
  fallbackSize: { w: number; h: number } = DEFAULT_SIZE,
): Frame {
  const w = geometry?.width ?? fallbackSize.w;
  const h = geometry?.height ?? fallbackSize.h;
  const cx = position?.x ?? 0;
  const cy = position?.y ?? 0;
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    rotation: ((geometry?.rotation ?? 0) * Math.PI) / 180,
  };
}

/**
 * Whether Miro expressed this position against the PARENT'S TOP-LEFT rather
 * than the canvas centre.
 *
 * `relativeTo` decides it when present. When it is absent the parent link is
 * the signal: an item only has a `parent` because it sits inside a frame, and
 * that is precisely the case Miro reports frame-locally.
 */
function isParentRelative(item: MiroFramedLike): boolean {
  const relativeTo = item.position?.relativeTo;
  if (relativeTo === 'parent_top_left') return true;
  if (relativeTo === 'canvas_center') return false;
  return typeof item.parent?.id === 'string';
}

/**
 * Resolve every item's BOARD-ABSOLUTE frame.
 *
 * Miro reports a framed item's `position` against its parent frame's top-left
 * corner, and only a parentless item against the canvas centre. Reading both
 * as absolute writes every framed item's frame-local coordinate — a small
 * positive number bounded by the frame's size — into the world, so an entire
 * board collapses into one box beside the origin while the frames stay spread
 * across their real coordinates.
 *
 * A parent contributes a pure translation by its own resolved top-left. Miro
 * frames cannot be rotated, so there is no rotation to compose.
 *
 * Resolution walks the parent chain and is memoised, so an item is converted
 * once however deep it sits. `orphans` names the items whose parent is not in
 * `items` at all — the import's item ceiling can cut a frame while keeping its
 * contents. Their raw position is kept (there is no absolute coordinate left
 * to recover) and the caller reports them rather than misplacing them
 * silently.
 */
export function resolveMiroFrames(items: MiroFramedLike[]): {
  frames: Map<string, Frame>;
  orphans: Set<string>;
} {
  const byId = new Map<string, MiroFramedLike>();
  for (const item of items) byId.set(item.id, item);

  const frames = new Map<string, Frame>();
  const orphans = new Set<string>();

  const resolve = (item: MiroFramedLike, chain: Set<string>): Frame => {
    const cached = frames.get(item.id);
    if (cached) return cached;

    const local = miroFrame(item.position, item.geometry);
    let frame = local;

    if (isParentRelative(item)) {
      const parent = byId.get(item.parent!.id!);
      // A cycle is not something Miro produces, but the payload is untrusted
      // and a self-referential parent would recurse forever. Treat it like a
      // missing parent: keep the raw position and report it.
      if (!parent || chain.has(parent.id)) {
        orphans.add(item.id);
      } else {
        chain.add(item.id);
        const parentFrame = resolve(parent, chain);
        chain.delete(item.id);
        frame = { ...local, x: local.x + parentFrame.x, y: local.y + parentFrame.y };
      }
    }

    frames.set(item.id, frame);
    return frame;
  };

  for (const item of items) resolve(item, new Set([item.id]));

  return { frames, orphans };
}
