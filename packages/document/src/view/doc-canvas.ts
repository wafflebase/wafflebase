import type { DocumentLayout, LayoutBlock, LayoutRun } from './layout.js';
import { Theme, buildFont } from './theme.js';

/**
 * Canvas rendering engine for the document editor.
 * Paints blocks, styled text runs, cursor, and selection highlights.
 */
export class DocCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Render the full document.
   */
  render(
    layout: DocumentLayout,
    scrollY: number,
    cursor?: { x: number; y: number; height: number; visible: boolean },
    selectionRects?: Array<{ x: number; y: number; width: number; height: number }>,
  ): void {
    const { width, height } = this.canvas;

    // Clear
    this.ctx.fillStyle = Theme.backgroundColor;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.translate(0, -scrollY);

    // Draw selection highlights
    if (selectionRects) {
      this.ctx.fillStyle = Theme.selectionColor;
      for (const rect of selectionRects) {
        this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    }

    // Draw text
    for (const lb of layout.blocks) {
      this.renderBlock(lb);
    }

    // Draw cursor
    if (cursor?.visible) {
      this.ctx.fillStyle = Theme.cursorColor;
      this.ctx.fillRect(cursor.x, cursor.y, Theme.cursorWidth, cursor.height);
    }

    this.ctx.restore();
  }

  /**
   * Render a single layout block.
   */
  private renderBlock(lb: LayoutBlock): void {
    for (const line of lb.lines) {
      for (const run of line.runs) {
        this.renderRun(run, lb.x, lb.y + line.y, line.height);
      }
    }
  }

  /**
   * Render a single text run.
   */
  private renderRun(
    run: LayoutRun,
    blockX: number,
    lineY: number,
    lineHeight: number,
  ): void {
    const style = run.inline.style;
    this.ctx.font = buildFont(
      style.fontSize,
      style.fontFamily,
      style.bold,
      style.italic,
    );
    this.ctx.fillStyle = style.color ?? Theme.defaultColor;
    this.ctx.textBaseline = 'alphabetic';

    const fontSize = style.fontSize ?? Theme.defaultFontSize;
    // Baseline position: vertically center text in line
    const baselineY = lineY + (lineHeight + fontSize * 0.8) / 2;
    const x = blockX + run.x;

    this.ctx.fillText(run.text, x, baselineY);

    // Underline decoration
    if (style.underline) {
      const underlineY = baselineY + 2;
      this.ctx.beginPath();
      this.ctx.strokeStyle = style.color ?? Theme.defaultColor;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x, underlineY);
      this.ctx.lineTo(x + run.width, underlineY);
      this.ctx.stroke();
    }
  }

  /**
   * Resize the canvas to fill its container.
   */
  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.scale(dpr, dpr);
  }
}
