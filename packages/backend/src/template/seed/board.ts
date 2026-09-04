import type { SlidesElement } from '../../yorkie/yorkie.types';

/**
 * The Yorkie root a board document stores.
 *
 * Mirrors `packages/frontend/src/types/board-document.ts#YorkieBoardRoot`.
 * There is no backend writer for boards the way there is for docs / slides /
 * notes — `PUT /documents/:id/content` covers only those three — so the seed
 * assigns this shape directly. A board is "one unbounded slide"
 * (docs/design/board/board.md), which is why its elements are slides
 * elements.
 */
export interface BoardRoot extends Record<string, unknown> {
  meta: { title: string };
  elements: SlidesElement[];
}
