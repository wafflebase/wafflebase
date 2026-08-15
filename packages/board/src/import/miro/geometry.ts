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
 *
 * Note that `parent_top_left` alone claims a parent-relative position without
 * proving a usable parent exists — the payload is untrusted, so the resolver
 * treats that as unresolvable rather than dereferencing `parent.id`.
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
 * `orphans` names every item whose absolute position could NOT be determined:
 * one that claims a parent the payload does not contain — the import's item
 * ceiling can cut a frame while keeping its contents — one caught in a parent
 * cycle, and anything DESCENDED from either, since an offset from an
 * unresolved coordinate is unresolved too. Their raw position is kept, because
 * there is no absolute coordinate left to recover, and the caller reports them
 * rather than misplacing them silently.
 *
 * The walk is iterative, not recursive: `MiroService.MAX_ITEMS` allows a
 * 5,000-long parent chain, which is within a browser's stack limit, and this
 * runs in the browser. Each chain is resolved top-down and memoised, so an
 * item is converted once however deep it sits.
 */
export function resolveMiroFrames(items: MiroFramedLike[]): {
  frames: Map<string, Frame>;
  orphans: Set<string>;
} {
  const byId = new Map<string, MiroFramedLike>();
  for (const item of items) byId.set(item.id, item);

  const frames = new Map<string, Frame>();
  const orphans = new Set<string>();

  for (const item of items) {
    if (frames.has(item.id)) continue;

    // Climb to the nearest ancestor that is already resolved, is absolute, or
    // cannot be resolved at all, collecting the unresolved chain on the way.
    const chain: MiroFramedLike[] = [];
    const onChain = new Set<string>();
    let anchor: Frame | undefined;
    let anchorUnresolved = false;

    let cursor: MiroFramedLike | undefined = item;
    while (cursor) {
      const resolved = frames.get(cursor.id);
      if (resolved) {
        anchor = resolved;
        anchorUnresolved = orphans.has(cursor.id);
        break;
      }
      chain.push(cursor);
      onChain.add(cursor.id);
      if (!isParentRelative(cursor)) break;

      const parentId: string | undefined = cursor.parent?.id;
      const parent: MiroFramedLike | undefined =
        typeof parentId === 'string' ? byId.get(parentId) : undefined;
      // No parent to offset by, or one that leads back into this chain. A
      // cycle is not something Miro produces, but the payload is untrusted and
      // an unguarded walk would never terminate.
      if (!parent || onChain.has(parent.id)) break;
      cursor = parent;
    }

    // Then apply the offsets back down, each item translating the one below it.
    let parentFrame = anchor;
    let parentUnresolved = anchorUnresolved;
    for (let i = chain.length - 1; i >= 0; i--) {
      const node = chain[i];
      const local = miroFrame(node.position, node.geometry);
      let frame = local;
      let unresolved = false;

      if (isParentRelative(node)) {
        if (parentFrame) {
          frame = { ...local, x: local.x + parentFrame.x, y: local.y + parentFrame.y };
          unresolved = parentUnresolved;
        } else {
          unresolved = true;
        }
      }

      frames.set(node.id, frame);
      if (unresolved) orphans.add(node.id);
      parentFrame = frame;
      parentUnresolved = unresolved;
    }
  }

  return { frames, orphans };
}
