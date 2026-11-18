import type { Frame } from "@wafflebase/slides";
import type { BoardAnchor } from "@/types/comments";
import type { YorkieBoardRoot } from "@/types/board-document";
import { frozenAnchorPoint } from "./board-anchor";
import { stampKeysForElements } from "./stamps";

/**
 * Tidy the ritual state that points at elements being deleted, inside the
 * SAME change as the delete (so one undo brings both back):
 *
 * - their stamps are removed, so `root.stamps` does not collect orphans;
 * - comment threads anchored to them get their last-known point refreshed
 *   to where the element is now, so the orphan pin stays put.
 *
 * `removed` maps each deleted id to its WORLD frame, or `null` for an
 * element nested in a group (its frame is group-local; stamps and pins
 * only anchor top-level elements, so there is nothing to freeze). Vote
 * ballots are left alone: they belong to their voter, and the tally drops
 * deleted elements on read.
 *
 * Works on a Yorkie proxy root and on a plain object alike.
 */
export function pruneRitualsOnDelete(
  root: YorkieBoardRoot,
  removed: ReadonlyMap<string, Frame | null>,
): void {
  if (removed.size === 0) return;
  const stamps = root.stamps;
  if (stamps) {
    for (const key of stampKeysForElements(stamps, new Set(removed.keys()))) {
      delete stamps[key];
    }
  }
  const comments = root.comments;
  if (!comments) return;
  const frames = new Map<string, Frame>();
  for (const [id, frame] of removed) if (frame) frames.set(id, frame);
  if (frames.size === 0) return;
  for (const threadId of Object.keys(comments)) {
    const anchor = comments[threadId]?.anchor as BoardAnchor | undefined;
    if (!anchor || anchor.kind !== "board") continue;
    const p = frozenAnchorPoint(
      { kind: "board", elementId: anchor.elementId, u: anchor.u, v: anchor.v, x: anchor.x, y: anchor.y },
      frames,
    );
    if (!p) continue;
    anchor.x = p.x;
    anchor.y = p.y;
  }
}
