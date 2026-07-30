import type { Block } from '../model/types.js';

/**
 * The full extent of the hyperlink run at `offset` within `block`:
 * the inline containing the offset, extended left and right across
 * adjacent inlines sharing the same `href` (a link split into
 * differently-styled sub-runs, e.g. a bold prefix, is one run).
 * Offsets are block-local; `end` is exclusive.
 */
export interface LinkRun {
  start: number;
  end: number;
  href: string;
}

/**
 * Find the link run at a caret offset, or `undefined` when the caret
 * isn't touching one. An offset on either edge of an `href` inline
 * counts as inside it. At the shared boundary between two adjacent
 * *different* links (end of A == start of B) the earlier run wins —
 * the same tie-break as `getLinkAtCursor` (both editors skip an
 * empty-text href residue at the boundary), so the link a popover
 * displays is the link that gets edited or removed.
 *
 * An empty-text inline cannot anchor a run: the `href` residue that
 * `normalizeInlines` leaves on a fully-emptied paragraph is not an
 * editable link, and a zero-width range would make `applyInlineStyle`
 * a silent no-op. (Empty inlines are still crossed by the lo/hi walk
 * when they sit inside a wider same-href run.)
 */
export function findLinkRunAt(block: Block, offset: number): LinkRun | undefined {
  const inlines = block.inlines;
  let cursorInlineIdx = -1;
  const offsets: number[] = [0];
  for (let i = 0; i < inlines.length; i++) {
    const inlineEnd = offsets[i] + inlines[i].text.length;
    offsets.push(inlineEnd);
    if (
      cursorInlineIdx < 0 &&
      offset >= offsets[i] &&
      offset <= inlineEnd &&
      inlines[i].text.length > 0 &&
      inlines[i].style.href
    ) {
      cursorInlineIdx = i;
    }
  }
  if (cursorInlineIdx < 0) return undefined;
  const href = inlines[cursorInlineIdx].style.href;
  if (!href) return undefined;
  let lo = cursorInlineIdx;
  while (lo > 0 && inlines[lo - 1].style.href === href) lo--;
  let hi = cursorInlineIdx;
  while (hi < inlines.length - 1 && inlines[hi + 1].style.href === href) hi++;
  return { start: offsets[lo], end: offsets[hi + 1], href };
}
