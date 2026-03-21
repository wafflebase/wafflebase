import type { DocPosition, DocRange } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import { buildFont } from './theme.js';

/**
 * Text selection state and highlight rectangle computation.
 */
export class Selection {
  range: DocRange | null = null;

  /**
   * Set the selection range.
   */
  setRange(range: DocRange | null): void {
    this.range = range;
  }

  /**
   * Check if there is an active selection.
   */
  hasSelection(): boolean {
    if (!this.range) return false;
    return (
      this.range.anchor.blockId !== this.range.focus.blockId ||
      this.range.anchor.offset !== this.range.focus.offset
    );
  }

  /**
   * Get the normalized range (start before end).
   */
  getNormalizedRange(
    layout: DocumentLayout,
  ): { start: DocPosition; end: DocPosition } | null {
    if (!this.range || !this.hasSelection()) return null;

    const anchorIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === this.range!.anchor.blockId,
    );
    const focusIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === this.range!.focus.blockId,
    );

    if (
      anchorIdx < focusIdx ||
      (anchorIdx === focusIdx &&
        this.range.anchor.offset <= this.range.focus.offset)
    ) {
      return { start: this.range.anchor, end: this.range.focus };
    }
    return { start: this.range.focus, end: this.range.anchor };
  }

  /**
   * Compute highlight rectangles for the selection in page space.
   */
  getSelectionRects(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
  ): Array<{ x: number; y: number; width: number; height: number }> {
    const normalized = this.getNormalizedRange(layout);
    if (!normalized) return [];

    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    const { start, end } = normalized;

    const startBlockIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === start.blockId,
    );
    const endBlockIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === end.blockId,
    );

    for (let bi = startBlockIdx; bi <= endBlockIdx; bi++) {
      const lb = layout.blocks[bi];
      const blockStart = bi === startBlockIdx ? start.offset : 0;
      const blockEnd =
        bi === endBlockIdx ? end.offset : getBlockTextLength(lb.block);

      if (blockStart >= blockEnd) continue;

      const startPixel = this.positionToPagePixel(
        paginatedLayout, layout, ctx, canvasWidth, lb.block.id, blockStart,
      );
      const endPixel = this.positionToPagePixel(
        paginatedLayout, layout, ctx, canvasWidth, lb.block.id, blockEnd,
      );

      if (!startPixel || !endPixel) continue;

      if (startPixel.y === endPixel.y) {
        // Same line
        rects.push({
          x: startPixel.x,
          y: startPixel.y,
          width: endPixel.x - startPixel.x,
          height: startPixel.height,
        });
      } else {
        // Multi-line: first line from start to end of line
        const pageX = getPageXOffset(paginatedLayout, canvasWidth);
        const startFound = findPageForPosition(paginatedLayout, lb.block.id, blockStart, layout);
        const endFound = findPageForPosition(paginatedLayout, lb.block.id, blockEnd, layout);
        if (!startFound || !endFound) continue;

        // First line: from start position to end of line
        const firstLineEnd = this.getLineEndX(startFound.pageLine.line, pageX + startFound.pageLine.x);
        rects.push({
          x: startPixel.x,
          y: startPixel.y,
          width: firstLineEnd - startPixel.x,
          height: startPixel.height,
        });

        // Middle lines (full width)
        for (const page of paginatedLayout.pages) {
          const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
          for (const pl of page.lines) {
            if (pl.blockIndex !== bi) continue;
            const lineY = pageY + pl.y;
            if (lineY <= startPixel.y || lineY >= endPixel.y) continue;
            const lineStartX = this.getLineStartX(pl.line, pageX + pl.x);
            const lineEndX = this.getLineEndX(pl.line, pageX + pl.x);
            rects.push({
              x: lineStartX,
              y: lineY,
              width: lineEndX - lineStartX,
              height: pl.line.height,
            });
          }
        }

        // Last line: from start of line to end position
        const lastLineStart = this.getLineStartX(endFound.pageLine.line, pageX + endFound.pageLine.x);
        rects.push({
          x: lastLineStart,
          y: endPixel.y,
          width: endPixel.x - lastLineStart,
          height: endPixel.height,
        });
      }
    }

    return rects;
  }

  /**
   * Get the selected text.
   */
  getSelectedText(layout: DocumentLayout): string {
    const normalized = this.getNormalizedRange(layout);
    if (!normalized) return '';

    const { start, end } = normalized;
    const texts: string[] = [];

    const startBlockIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === start.blockId,
    );
    const endBlockIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === end.blockId,
    );

    for (let bi = startBlockIdx; bi <= endBlockIdx; bi++) {
      const lb = layout.blocks[bi];
      const fullText = lb.block.inlines.map((i) => i.text).join('');
      const blockStart = bi === startBlockIdx ? start.offset : 0;
      const blockEnd =
        bi === endBlockIdx ? end.offset : fullText.length;
      texts.push(fullText.slice(blockStart, blockEnd));
    }

    return texts.join('\n');
  }

  // --- Private helpers ---

  private positionToPagePixel(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    blockId: string,
    offset: number,
  ): { x: number; y: number; height: number } | undefined {
    const found = findPageForPosition(paginatedLayout, blockId, offset, layout);
    if (!found) return undefined;

    const { pageIndex, pageLine } = found;
    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const pageY = getPageYOffset(paginatedLayout, pageIndex);
    const lb = layout.blocks[pageLine.blockIndex];

    let charsBeforeLine = 0;
    for (let li = 0; li < pageLine.lineIndex; li++) {
      for (const r of lb.lines[li].runs) {
        charsBeforeLine += r.charEnd - r.charStart;
      }
    }
    const lineOffset = offset - charsBeforeLine;

    let charCount = 0;
    for (const run of pageLine.line.runs) {
      const runLength = run.charEnd - run.charStart;
      if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
        const localOff = lineOffset - charCount;
        ctx.font = buildFont(
          run.inline.style.fontSize, run.inline.style.fontFamily,
          run.inline.style.bold, run.inline.style.italic,
        );
        const x = pageX + pageLine.x + run.x + ctx.measureText(run.text.slice(0, localOff)).width;
        return { x, y: pageY + pageLine.y, height: pageLine.line.height };
      }
      charCount += runLength;
    }

    // Fallback: end of line
    const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
    if (lastRun) {
      return {
        x: pageX + pageLine.x + lastRun.x + lastRun.width,
        y: pageY + pageLine.y, height: pageLine.line.height,
      };
    }
    return { x: pageX + pageLine.x, y: pageY + pageLine.y, height: 24 };
  }

  private getLineEndX(line: LayoutLine, lineBaseX: number): number {
    if (line.runs.length === 0) return lineBaseX;
    const last = line.runs[line.runs.length - 1];
    return lineBaseX + last.x + last.width;
  }

  private getLineStartX(line: LayoutLine, lineBaseX: number): number {
    if (line.runs.length === 0) return lineBaseX;
    const first = line.runs[0];
    return lineBaseX + first.x;
  }
}
