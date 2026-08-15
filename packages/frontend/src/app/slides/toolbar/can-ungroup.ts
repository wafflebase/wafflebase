import type { SlidesEditor, SlidesStore } from '@wafflebase/slides';
import { findElementPath } from '@wafflebase/slides';

/**
 * Whether Arrange ▸ Ungroup should be enabled for the current selection:
 * exactly one element is selected and it resolves to a `group`.
 *
 * `findElementPath` (not a top-level `find`) so a group nested inside
 * another group — reachable once the user has drilled in — still counts.
 *
 * Shared by the slides `ObjectSection` and the board toolbar. Both mount
 * the same `ArrangeMenu` against the same `(editor, store)` pair, and a
 * board is just one synthetic slide, so there is nothing board-specific
 * to fork here — leaving `canUngroup` at its `false` default (as the
 * board did) greys out Ungroup permanently, including right after the
 * user grouped something from that very menu.
 */
export function canUngroupSelection(
  editor: SlidesEditor | null,
  store: SlidesStore | null,
  ids: readonly string[],
): boolean {
  if (ids.length !== 1) return false;
  const slideId = editor?.getCurrentSlideId();
  const slide =
    store && slideId
      ? store.read().slides.find((s) => s.id === slideId)
      : undefined;
  if (!slide) return false;
  const path = findElementPath(slide.elements, ids[0]);
  return path?.[path.length - 1]?.type === 'group';
}
