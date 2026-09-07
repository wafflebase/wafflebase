import type { Doc } from '../model/document.js';
import type { Block, DocPosition, DocRange } from '../model/types.js';
import { getBlockText } from '../model/types.js';

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

/**
 * Whether the run's display text is its own URL, i.e. the user never
 * customised it. True for the two most common ways a link is born: ⌘K
 * with no selection inserts the URL as its own text, and autolink links
 * exactly the typed `https?://…` token. An in-place href edit rewrites
 * the text only in that case — a custom label must survive (#494/#580).
 */
export function linkTextFollowsHref(block: Block, run: LinkRun): boolean {
  return getBlockText(block).slice(run.start, run.end) === run.href;
}

/**
 * The link run strictly containing `offset`, or `undefined`.
 *
 * Deliberately *not* `findLinkRunAt`'s edge-inclusive test: an offset at
 * `run.end` counts as inside the run for a caret (the popover has to open
 * when you click just past the link), but as a selection endpoint it means
 * the selection merely abuts the link with none of its characters
 * selected, and expanding there would swallow a link the user never
 * touched.
 */
function interiorLinkRunAt(block: Block, offset: number): LinkRun | undefined {
  const run = findLinkRunAt(block, offset);
  if (!run) return undefined;
  return offset > run.start && offset < run.end ? run : undefined;
}

/**
 * Order a range's endpoints without a `DocumentLayout`.
 *
 * Returns `true`/`false` when the anchor is known to come first/second in
 * document order, and `undefined` when the pair cannot be ordered from the
 * model alone — `getBlockIndex` only sees the current edit context's
 * top-level blocks, so a range spanning two blocks inside one table cell
 * (or a header/footer region) is unorderable here. Callers must decline to
 * act rather than guess: expanding an endpoint in the wrong direction
 * *shrinks* the selection.
 */
function anchorComesFirst(doc: Doc, range: DocRange): boolean | undefined {
  if (range.anchor.blockId === range.focus.blockId) {
    return range.anchor.offset <= range.focus.offset;
  }
  const anchorIdx = doc.getBlockIndex(range.anchor.blockId);
  const focusIdx = doc.getBlockIndex(range.focus.blockId);
  if (anchorIdx < 0 || focusIdx < 0) return undefined;
  return anchorIdx < focusIdx;
}

/** Re-point an endpoint at `offset`, dropping a now-stale wrap affinity. */
function withOffset(pos: DocPosition, offset: number): DocPosition {
  if (pos.offset === offset) return pos;
  return { blockId: pos.blockId, offset };
}

/**
 * Grow a selection outward so that any hyperlink it partially covers is
 * covered whole — a link behaves as an atomic unit, the same way
 * `expandCellRangeForMerges` treats a merged cell.
 *
 * Operates on the *normalized* range because either endpoint can land
 * mid-link: the anchor is fixed at mousedown and never revisited, so
 * correcting only the moving focus would leave a drag that *began*
 * mid-link uncorrected. Direction-independent for the same reason.
 *
 * Two ranges are returned unchanged:
 *
 * - `tableCellRange` mode, where whole cells are selected and block-local
 *   offsets mean nothing.
 * - a **collapsed** range. Expanding a caret sitting inside a link would
 *   make `hasSelection()` true, which bypasses `insertLink`'s
 *   edit-in-place branch, offers "Add comment" where it is currently
 *   refused, and flips ⌘B from caret style to range style.
 */
export function expandRangeForLinks(doc: Doc, range: DocRange): DocRange {
  if (range.tableCellRange) return range;
  if (
    range.anchor.blockId === range.focus.blockId &&
    range.anchor.offset === range.focus.offset
  ) {
    return range;
  }

  const anchorFirst = anchorComesFirst(doc, range);
  if (anchorFirst === undefined) return range;

  const start = anchorFirst ? range.anchor : range.focus;
  const end = anchorFirst ? range.focus : range.anchor;

  const startBlock = doc.findBlock(start.blockId);
  const endBlock = doc.findBlock(end.blockId);
  const startRun = startBlock ? interiorLinkRunAt(startBlock, start.offset) : undefined;
  const endRun = endBlock ? interiorLinkRunAt(endBlock, end.offset) : undefined;
  if (!startRun && !endRun) return range;

  const newStart = withOffset(start, startRun ? startRun.start : start.offset);
  const newEnd = withOffset(end, endRun ? endRun.end : end.offset);
  return anchorFirst
    ? { anchor: newStart, focus: newEnd }
    : { anchor: newEnd, focus: newStart };
}
