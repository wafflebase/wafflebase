import type { DocPosition } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import type { TextMeasurer } from './measurer.js';
import { Theme } from './theme.js';
import { resolvePositionPixel } from './peer-cursor.js';

/**
 * Cursor state and blink animation.
 */
export class Cursor {
  /**
   * The caret, affinity included. This is the single home for caret
   * affinity: `position.lineAffinity` is what {@link lineAffinity} reads
   * and writes, so the affinity travels with the position into presence,
   * undo history, selection endpoints and rendering rather than living in
   * a sibling field that every consumer taking a `DocPosition` drops.
   * A caret always states its reading (see {@link moveTo}).
   */
  position: DocPosition;
  private visible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private onBlink: (() => void) | null = null;

  constructor(blockId: string, offset: number = 0) {
    this.position = { blockId, offset, lineAffinity: 'backward' };
  }

  /**
   * The visual line the caret is drawn on when its offset sits exactly on a
   * wrap boundary. Backed by `position.lineAffinity`, so assigning it moves
   * the caret's reading and the position's in one step.
   */
  get lineAffinity(): 'forward' | 'backward' {
    return this.position.lineAffinity ?? 'backward';
  }

  set lineAffinity(affinity: 'forward' | 'backward') {
    this.position = { ...this.position, lineAffinity: affinity };
  }

  /**
   * Move cursor to a new position and reset blink.
   * @param affinity — 'forward' renders at the start of the next visual line
   *   at a wrap boundary; 'backward' renders at the end of the current
   *   visual line. Defaults to the affinity `pos` already carries (a
   *   mouse hit, a resolved anchor, a restored presence position), and to
   *   'backward' when it carries none. Always materialized on
   *   {@link position}, so whatever publishes the caret publishes its
   *   reading too.
   */
  moveTo(pos: DocPosition, affinity?: 'forward' | 'backward'): void {
    this.position = {
      ...pos,
      lineAffinity: affinity ?? pos.lineAffinity ?? 'backward',
    };
    this.resetBlink();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Get pixel coordinates of the cursor for rendering (paginated).
   */
  getPixelPosition(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    measurer: TextMeasurer,
    canvasWidth: number,
  ): { x: number; y: number; height: number; visible: boolean } | undefined {
    const pixel = resolvePositionPixel(
      this.position, this.lineAffinity, paginatedLayout, layout, measurer, canvasWidth,
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
