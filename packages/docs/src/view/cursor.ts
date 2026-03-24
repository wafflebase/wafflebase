import type { DocPosition } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import { Theme } from './theme.js';
import { resolvePositionPixel } from './peer-cursor.js';

/**
 * Cursor state and blink animation.
 */
export class Cursor {
  position: DocPosition;
  lineAffinity: 'forward' | 'backward' = 'backward';
  private visible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private onBlink: (() => void) | null = null;

  constructor(blockId: string, offset: number = 0) {
    this.position = { blockId, offset };
  }

  /**
   * Move cursor to a new position and reset blink.
   * @param affinity — 'forward' renders at the start of the next visual line
   *   at a wrap boundary; 'backward' (default) renders at the end of the
   *   current visual line.
   */
  moveTo(pos: DocPosition, affinity: 'forward' | 'backward' = 'backward'): void {
    this.position = pos;
    this.lineAffinity = affinity;
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
    const pixel = resolvePositionPixel(
      this.position, this.lineAffinity, paginatedLayout, layout, ctx, canvasWidth,
    );
    if (!pixel) return undefined;
    return { ...pixel, visible: this.visible };
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
