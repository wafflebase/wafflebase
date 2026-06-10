import type { ResolvedFont, TextMeasurer } from './measurer.js';
import { resolveFontFamily } from './fonts.js';

/**
 * Build the Canvas 2D `font` shorthand for a `ResolvedFont`.
 *
 * Mirrors the format `buildFont` in `theme.ts` produces from inline
 * styles (`'<italic? ><bold? ><sizepx> <family>'`) so cached `ctx.font`
 * strings round-trip cleanly between layout and the canvas painter.
 *
 * The family is routed through `resolveFontFamily` so the Korean
 * fallback splice lands in `ctx.font` here too — otherwise the
 * Canvas measurer would size Hangul against the raw Latin face while
 * paint draws with Noto Sans KR for the same glyph, producing a width
 * mismatch between measurement and paint.
 */
function fontToCss(font: ResolvedFont): string {
  const style = font.style === 'italic' ? 'italic ' : '';
  const weight = font.weight === 'bold' ? 'bold ' : '';
  return `${style}${weight}${font.size}px ${resolveFontFamily(font.family)}`;
}

/**
 * `TextMeasurer` backed by a Canvas 2D context. Used by the editor and
 * PDF exporter in the browser; the CLI uses a `fontkit`-based measurer
 * instead so it can run in Node without a native canvas dep.
 *
 * The measurer **always owns a private 2D context** (an `OffscreenCanvas`
 * by default, falling back to a detached `<canvas>` element on older
 * Safari). This isolation matters: paint code mutates `ctx.font` while
 * drawing, and the measurer memoises the last-set CSS font string to
 * avoid thrashing `ctx.font`. If the measurer shared the visible
 * canvas's ctx with paint, a stale `lastFont` could short-circuit the
 * font reset and `measureText` would silently run against whatever font
 * paint last assigned.
 *
 * Construction is lazy — we don't allocate the offscreen canvas until
 * the first `measureWidth` call so test and Node code paths that build
 * an editor without rendering pay nothing. Because the OffscreenCanvas
 * is owned by the measurer instance, the `lastFont` cache survives
 * across calls regardless of what paint does to its own ctx.
 */
export class CanvasTextMeasurer implements TextMeasurer {
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFont: string | null = null;

  /**
   * Production constructor: the measurer creates and owns its own
   * `OffscreenCanvas` (or detached `<canvas>`) lazily. There is no
   * public ctx-injection path — sharing a ctx with paint code is unsafe
   * because paint mutates `ctx.font` mid-frame.
   *
   * Tests that need to introspect the underlying ctx (font assignments,
   * measureText calls) should use {@link fromContext}.
   */
  constructor() {}

  /**
   * Test-only escape hatch: build a measurer that uses a caller-supplied
   * 2D context. Production code must never share a paint ctx with a
   * measurer — see the class-level note. This factory is split from the
   * default constructor so the unsafe path is visible at every call
   * site.
   */
  static fromContext(ctx: CanvasRenderingContext2D): CanvasTextMeasurer {
    const m = new CanvasTextMeasurer();
    m.ctx = ctx;
    return m;
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
          'Use CanvasTextMeasurer.fromContext(ctx) with a known-good ctx, ' +
          'or use a non-Canvas TextMeasurer.',
      );
    }
    this.ctx = ctx;
    return ctx;
  }
}
