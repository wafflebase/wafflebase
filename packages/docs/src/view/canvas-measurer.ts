import type { ResolvedFont, TextMeasurer } from './measurer.js';

/**
 * Build the Canvas 2D `font` shorthand for a `ResolvedFont`.
 *
 * Mirrors the format `buildFont` in `theme.ts` produces from inline
 * styles (`'<italic? ><bold? ><sizepx> <family>'`) so cached `ctx.font`
 * strings round-trip cleanly between layout and the canvas painter.
 */
function fontToCss(font: ResolvedFont): string {
  const style = font.style === 'italic' ? 'italic ' : '';
  const weight = font.weight === 'bold' ? 'bold ' : '';
  return `${style}${weight}${font.size}px ${font.family}`;
}

/**
 * `TextMeasurer` backed by a Canvas 2D context. Used by the editor and
 * PDF exporter in the browser; the CLI uses a `fontkit`-based measurer
 * instead so it can run in Node without a native canvas dep.
 *
 * Construction is lazy — we don't allocate the offscreen canvas until
 * the first `measureWidth` call so test and Node code paths that build
 * an editor without rendering pay nothing. The instance memoises the
 * last-set CSS font string so a sequence of measurements at one font
 * does not thrash `ctx.font` (which on some browsers re-resolves the
 * font face every assignment).
 */
export class CanvasTextMeasurer implements TextMeasurer {
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFont: string | null = null;

  /**
   * Optional override for tests / advanced callers that already own a
   * 2D context. When omitted, the measurer creates an `OffscreenCanvas`
   * lazily, falling back to a detached `<canvas>` element if the host
   * lacks `OffscreenCanvas` (older Safari).
   */
  constructor(ctx?: CanvasRenderingContext2D) {
    if (ctx) this.ctx = ctx;
  }

  measureWidth(text: string, font: ResolvedFont): number {
    const ctx = this.getCtx();
    const fontStr = fontToCss(font);
    if (this.lastFont !== fontStr) {
      ctx.font = fontStr;
      this.lastFont = fontStr;
    }
    return ctx.measureText(text).width;
  }

  private getCtx(): CanvasRenderingContext2D {
    if (this.ctx) return this.ctx;
    // Prefer OffscreenCanvas — it doesn't attach to the DOM and works
    // inside Web Workers. Fall back to a detached `<canvas>` for older
    // Safari versions that haven't shipped OffscreenCanvas yet.
    const OffscreenCanvasCtor = (
      globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }
    ).OffscreenCanvas;
    let ctx: CanvasRenderingContext2D | null = null;
    if (OffscreenCanvasCtor) {
      const canvas = new OffscreenCanvasCtor(1, 1);
      // OffscreenCanvas's 2D context is technically `OffscreenCanvasRenderingContext2D`,
      // but its measurement API is a strict subset of CanvasRenderingContext2D
      // and the browser layout code only touches `font` and `measureText`.
      ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D | null;
    }
    if (!ctx && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
    if (!ctx) {
      throw new Error(
        'CanvasTextMeasurer: no Canvas 2D context available. ' +
          'Construct with an explicit ctx, or use a non-Canvas TextMeasurer.',
      );
    }
    this.ctx = ctx;
    return ctx;
  }
}
