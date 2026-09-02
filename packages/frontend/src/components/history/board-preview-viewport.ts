import type { Frame, SlidesDocument, Viewport } from '@wafflebase/slides';

import { fitViewportToScene } from '@/app/board/fit-to-content';
import { sceneBounds } from '@/app/board/minimap-geometry';

/**
 * What the preview falls back to when there is nothing to frame — an empty
 * board, or a host that has not been measured yet. Matches `board-view.tsx`'s
 * own behaviour: `createFitToContentOnce` leaves `DEFAULT_VIEWPORT` in place
 * rather than "fitting to nothing".
 */
export const ORIGIN_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1 };

/** Top-level element frames of the board's single synthetic slide. */
function boardFrames(doc: SlidesDocument): Frame[] {
  const slide = doc.slides[0];
  return slide ? slide.elements.map((e) => e.frame) : [];
}

/**
 * The viewport a board revision preview should open at.
 *
 * The board plane is unbounded and board content routinely sits far from the
 * world origin — a Miro import especially, and this repo's own board fixture
 * puts an element at `x: -240`. The preview used to hard-code
 * `{panX: 0, panY: 0, zoom: 1}`, and because a `readOnly` mount has no
 * wheel-pan, drag-pan or minimap (all of those are implemented in
 * `board-view.tsx`, at the host level, and none of them is replicated in the
 * preview), that produced a blank canvas the user had no way to pan to — the
 * same user-visible symptom as a snapshot that failed to parse, reached
 * differently.
 *
 * Reuses the live board's own framing maths (`fitViewportToScene` +
 * `sceneBounds`) so the preview opens on the same view the board itself
 * would. No latch is needed here: unlike the live board, whose Yorkie
 * document has usually not synced when the mount effect runs, a revision
 * snapshot is fully parsed before this is ever called, and a `readOnly`
 * preview has no user pan to yank.
 */
export function boardPreviewViewport(
  doc: SlidesDocument,
  host: { w: number; h: number },
): Viewport {
  return fitViewportToScene(sceneBounds(boardFrames(doc)), host) ?? ORIGIN_VIEWPORT;
}
