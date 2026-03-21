import type { DocPosition } from '../model/types.js';
import type { DocumentLayout } from './layout.js';
import { positionToPixel } from './layout.js';
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
   * Get pixel coordinates of the cursor for rendering.
   */
  getPixelPosition(
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
  ): { x: number; y: number; height: number; visible: boolean } | undefined {
    const pixel = positionToPixel(
      layout,
      this.position.blockId,
      this.position.offset,
      ctx,
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
