import type { Element } from "@wafflebase/slides";
import { sectionMemberIds, sectionOf } from "@wafflebase/board";

/**
 * Top-level elements inside a hidden section — the ones its cover hides
 * on the canvas, whose stamps, votes and comment pins must not float
 * over that cover. The hidden section itself stays visible (it is the
 * cover). A locked section hides nothing: its marks stay drawn, and the
 * editor's hit test already refuses a stamp or comment on it.
 */
export function hiddenSectionContentIds(
  elements: readonly Element[],
): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    if (!sectionOf(el)?.hidden) continue;
    for (const id of sectionMemberIds(elements, el)) out.add(id);
  }
  return out;
}
