import type { DocPosition, DocRange } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import type { DocumentLayout, LayoutBlock, LayoutLine } from './layout.js';
import { positionToPixel } from './layout.js';

function getLineRunBounds(
  lb: LayoutBlock,
  line: LayoutLine,
): { startX: number; endX: number } {
  if (line.runs.length === 0) return { startX: lb.x, endX: lb.x };
  const first = line.runs[0];
  const last = line.runs[line.runs.length - 1];
  return { startX: lb.x + first.x, endX: lb.x + last.x + last.width };
}

function getLineEndX(lb: LayoutBlock, lineY: number): number {
  for (const line of lb.lines) {
    if (Math.abs(lb.y + line.y - lineY) < 1) {
      const bounds = getLineRunBounds(lb, line);
      return bounds.endX;
    }
  }
  return lb.x + lb.width;
}

function getLineStartX(lb: LayoutBlock, lineY: number): number {
  for (const line of lb.lines) {
    if (Math.abs(lb.y + line.y - lineY) < 1) {
      const bounds = getLineRunBounds(lb, line);
      return bounds.startX;
    }
  }
  return lb.x;
}

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
   * Compute highlight rectangles for the selection.
   */
  getSelectionRects(
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
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

      const startPixel = positionToPixel(layout, lb.block.id, blockStart, ctx);
      const endPixel = positionToPixel(layout, lb.block.id, blockEnd, ctx);

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
        // Multi-line: use actual line run bounds for accurate highlights
        const firstLineEnd = getLineEndX(lb, startPixel.y);
        rects.push({
          x: startPixel.x,
          y: startPixel.y,
          width: firstLineEnd - startPixel.x,
          height: startPixel.height,
        });

        // Middle full lines
        for (const line of lb.lines) {
          const lineY = lb.y + line.y;
          if (lineY <= startPixel.y || lineY >= endPixel.y) continue;
          const { startX, endX } = getLineRunBounds(lb, line);
          rects.push({
            x: startX,
            y: lineY,
            width: endX - startX,
            height: line.height,
          });
        }

        // Last line from start to end position
        const lastLineStart = getLineStartX(lb, endPixel.y);
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
}
