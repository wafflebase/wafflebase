/**
 * Resolved font for measurement. The four fields collectively determine
 * the metrics returned by a `TextMeasurer.measureWidth` call.
 *
 * Sizes are in CSS pixels (px), already converted from the inline's
 * stored point size via `ptToPx`. Keeping `weight` and `style` as
 * narrow string unions matches the shape the Canvas 2D `font` shorthand
 * needs and avoids surprising callers with arbitrary CSS keywords that
 * other backends (`fontkit`, etc.) would not understand.
 */
export interface ResolvedFont {
  family: string;
  size: number;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  /**
   * Extra per-character spacing in CSS pixels (from `InlineStyle.letterSpacing`,
   * converted pt→px). Applied additively — `measureWidth` adds
   * `letterSpacing * text.length` — so measured widths stay slice-additive
   * and are an upper bound on the painted width (never overflow). Absent /
   * `0` = normal spacing.
   */
  letterSpacing?: number;
}

/**
 * Backend-agnostic text width measurement. A browser editor passes a
 * `CanvasTextMeasurer`; the CLI ships a `fontkit`-backed implementation
 * so pagination can run in Node without a native canvas binding.
 *
 * Implementations must return widths in CSS pixels for the supplied
 * `font` so that callers (layout, hit-testing) interoperate with the
 * same coordinate space the renderer paints in.
 */
export interface TextMeasurer {
  measureWidth(text: string, font: ResolvedFont): number;
}
