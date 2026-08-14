/**
 * Reading the text runs a `DocRange` covers.
 *
 * The *which text* question is answered by `visitRangeSlices`
 * (`model/range-slices.ts`) — the same traversal `Doc.applyInlineStyle` writes
 * through, so the runs read here are exactly the runs a toggle then styles.
 * That identity is what issue #715 was missing. This module only adds the
 * *what style* layer on top of those slices.
 *
 * Every visited run is reported with its *effective* style — the block's
 * named-style inline defaults (`resolveStyleInline`) layered under the run's
 * explicit style — so a read sees the value the renderer paints. A built-in
 * heading whose named style sets `italic` reads as italic even though no run
 * carries the flag.
 *
 * Zero-width runs (empty placeholder inlines) are skipped: they carry no
 * style information and would otherwise make every empty block look "mixed".
 */
import type { Block, DocRange, Inline, InlineStyle } from './types.js';
import { blockStyleId, resolveStyleInline } from './named-styles.js';
import { visitCellRectangleSlices, visitRangeSlices } from './range-slices.js';
import type { Doc } from './document.js';

/**
 * Called once per text run overlapping the range.
 *
 * @param style    Effective style — named-style defaults under `inline.style`.
 * @param inline   The run itself (raw `inline.style` available on it).
 * @param block    The block the run belongs to.
 * @param from     Run start offset within the block, clipped to the range.
 * @param to       Run end offset within the block, clipped to the range.
 */
export type StyledRunVisitor = (
  style: Partial<InlineStyle>,
  inline: Inline,
  block: Block,
  from: number,
  to: number,
) => void;

/**
 * Visit every text run the range covers, in document order.
 *
 * A cell rectangle (`tableCellRange`) is a selection shape of its own, handled
 * above `Doc.applyInlineStyle` by the editors' `applyStyleToCellRange`; it is
 * dispatched here to the matching slice walk so the summary and those writes
 * still describe the same cells.
 */
export function visitStyledRunsInRange(
  doc: Doc,
  range: DocRange,
  visit: StyledRunVisitor,
): void {
  const visitSlice = (blockId: string, from: number, to: number): void => {
    const block = doc.findBlock(blockId);
    if (!block) return;
    const defaults = resolveStyleInline(blockStyleId(block), doc.document.styles);
    let pos = 0;
    for (const inline of block.inlines) {
      const inlineEnd = pos + inline.text.length;
      // Overlap test [from, to) with [pos, inlineEnd).
      if (inline.text.length > 0 && inlineEnd > from && pos < to) {
        visit(
          { ...defaults, ...inline.style },
          inline,
          block,
          Math.max(pos, from),
          Math.min(inlineEnd, to),
        );
      }
      pos = inlineEnd;
      if (pos >= to) break;
    }
  };

  if (range.tableCellRange) {
    visitCellRectangleSlices(doc, range.tableCellRange, visitSlice);
    return;
  }
  visitRangeSlices(doc, range, visitSlice);
}
