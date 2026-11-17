/**
 * Pure fold arithmetic for `ToolbarOverflow` (./toolbar-overflow.tsx),
 * kept apart from the component so it is testable without layout.
 */

/** Sub-pixel slack: `offsetWidth` rounds, and a 0.4px miss is not overflow. */
const SLACK = 1;

export interface FoldItem {
  /** Right edge of the child, measured from the strip's left edge. */
  right: number;
  /** Whether the child is a group separator (never left dangling). */
  separator: boolean;
}

/**
 * Index of the first child that folds into the More menu, or `null` when
 * everything fits. `avail` is the room the strip gets *with* the More
 * button shown, so content that fits once the button goes away
 * (`avail + moreWidth`) folds nothing. A separator left at the end of the
 * visible run folds too — a strip never ends on a divider.
 */
export function computeFoldIndex(
  items: readonly FoldItem[],
  avail: number,
  moreWidth: number,
): number | null {
  const total = items.reduce((max, item) => Math.max(max, item.right), 0);
  if (total <= avail + moreWidth + SLACK) return null;
  let k = 0;
  while (k < items.length && items[k].right <= avail + SLACK) k++;
  while (k > 0 && items[k - 1].separator) k--;
  return k;
}

/**
 * Whether child `i` of the popover copy is hidden: everything still shown
 * in the strip, plus the separators that would otherwise open the menu.
 */
export function isHiddenInMenu(
  separators: readonly boolean[],
  foldAt: number,
  i: number,
): boolean {
  if (i < foldAt) return true;
  for (let j = foldAt; j <= i; j++) if (!separators[j]) return false;
  return true;
}
