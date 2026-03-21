import type { DocPosition } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import { buildFont } from './theme.js';
import { Theme } from './theme.js';

/**
 * Cursor state and blink animation.
 */
export class Cursor {
  position: DocPosition;
  private visible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private onBlink: (() => void) | null = null;

  constructor(blockId: string, offset: number = 0) {
    this.position = { blockId, offset };
  }

  /**
   * Move cursor to a new position and reset blink.
   */
  moveTo(pos: DocPosition): void {
    this.position = pos;
    this.resetBlink();
  }

  /**
   * Get pixel coordinates of the cursor for rendering (paginated).
   */
  getPixelPosition(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
  ): { x: number; y: number; height: number; visible: boolean } | undefined {
    const found = findPageForPosition(
      paginatedLayout, this.position.blockId, this.position.offset, layout,
    );
    if (!found) return undefined;

    const { pageIndex, pageLine } = found;
    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const pageY = getPageYOffset(paginatedLayout, pageIndex);
    const lb = layout.blocks[pageLine.blockIndex];

    // Count chars before this line
    let charsBeforeLine = 0;
    for (let li = 0; li < pageLine.lineIndex; li++) {
      for (const r of lb.lines[li].runs) {
        charsBeforeLine += r.charEnd - r.charStart;
      }
    }
    const lineOffset = this.position.offset - charsBeforeLine;

    let charCount = 0;
    for (const run of pageLine.line.runs) {
      const runLength = run.charEnd - run.charStart;
      if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
        const localOffset = lineOffset - charCount;
        const textBefore = run.text.slice(0, localOffset);
        ctx.font = buildFont(
          run.inline.style.fontSize, run.inline.style.fontFamily,
          run.inline.style.bold, run.inline.style.italic,
        );
        const x = pageX + pageLine.x + run.x + ctx.measureText(textBefore).width;
        return { x, y: pageY + pageLine.y, height: pageLine.line.height, visible: this.visible };
      }
      charCount += runLength;
    }

    // Fallback: end of line
    const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
    if (lastRun) {
      return {
        x: pageX + pageLine.x + lastRun.x + lastRun.width,
        y: pageY + pageLine.y, height: pageLine.line.height, visible: this.visible,
      };
    }
    return { x: pageX + pageLine.x, y: pageY + pageLine.y, height: pageLine.line.height, visible: this.visible };
  }

  /**
   * Start the blink animation.
   */
  startBlink(onBlink: () => void): void {
    this.onBlink = onBlink;
    this.stopBlink();
    this.visible = true;
    this.blinkTimer = setInterval(() => {
      this.visible = !this.visible;
      this.onBlink?.();
    }, Theme.cursorBlinkInterval);
  }

  /**
   * Stop the blink animation.
   */
  stopBlink(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  /**
   * Reset blink (show cursor immediately).
   */
  private resetBlink(): void {
    this.visible = true;
    if (this.onBlink) {
      this.stopBlink();
      this.startBlink(this.onBlink);
    }
  }

  dispose(): void {
    this.stopBlink();
  }
}
