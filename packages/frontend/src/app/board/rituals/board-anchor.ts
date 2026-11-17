import type { Frame } from "@wafflebase/slides";
import type { BoardAnchor } from "@/types/comments";
import {
  clampFraction,
  frameFractionToWorld,
  worldToFrameFraction,
} from "./frame-fraction";

/** An anchor pinned to `frame`'s element at the world point `at`. */
export function elementAnchor(
  elementId: string,
  frame: Frame,
  at: { x: number; y: number },
): BoardAnchor {
  const { u, v } = worldToFrameFraction(frame, at);
  const cu = clampFraction(u);
  const cv = clampFraction(v);
  const p = frameFractionToWorld(frame, cu, cv);
  return { kind: "board", elementId, u: cu, v: cv, x: p.x, y: p.y };
}

/** An anchor at a world point on the open plane. */
export function pointAnchor(at: { x: number; y: number }): BoardAnchor {
  return { kind: "board", x: at.x, y: at.y };
}

export interface ResolvedAnchor {
  x: number;
  y: number;
  /** The anchor names an element that no longer exists at the top level. */
  orphan: boolean;
}

/**
 * Where an anchor's pin goes now. An element anchor follows its element;
 * once the element is gone it falls back to the stored last-known point
 * and reports itself an orphan. A point anchor never orphans.
 */
export function resolveBoardAnchor(
  anchor: BoardAnchor,
  frames: ReadonlyMap<string, Frame>,
): ResolvedAnchor {
  if (anchor.elementId) {
    const frame = frames.get(anchor.elementId);
    if (frame) {
      const p = frameFractionToWorld(frame, anchor.u ?? 0.5, anchor.v ?? 0.5);
      return { x: p.x, y: p.y, orphan: false };
    }
    return { x: anchor.x, y: anchor.y, orphan: true };
  }
  return { x: anchor.x, y: anchor.y, orphan: false };
}

/**
 * The refreshed last-known point for an element anchor whose element is
 * about to be deleted, or `null` when the anchor is not on one of
 * `removed` (or the element's frame is unknown). Run in the same change
 * as the delete, so the orphan's pin stays where the element was rather
 * than where it was first commented on.
 */
export function frozenAnchorPoint(
  anchor: BoardAnchor,
  removed: ReadonlyMap<string, Frame>,
): { x: number; y: number } | null {
  if (!anchor.elementId) return null;
  const frame = removed.get(anchor.elementId);
  if (!frame) return null;
  return frameFractionToWorld(frame, anchor.u ?? 0.5, anchor.v ?? 0.5);
}

/** The side-panel label for a thread's anchor. */
export function boardAnchorLabel(
  anchor: BoardAnchor,
  liveIds: ReadonlySet<string>,
): string {
  if (!anchor.elementId) return "On the board";
  return liveIds.has(anchor.elementId) ? "On an object" : "Object deleted";
}
