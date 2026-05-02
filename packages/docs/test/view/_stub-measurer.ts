import type { ResolvedFont, TextMeasurer } from '../../src/view/measurer.js';

/**
 * Deterministic measurer used by layout / pagination unit tests.
 *
 * Returns a fixed pixel width per character regardless of font, so tests
 * don't depend on jsdom's missing Canvas 2D context. The default 8 px
 * matches the long-standing `mockCtx` used across the docs test suite.
 *
 * Pass `respectFontSize` when a test cares that sup/sub renders at 60%
 * of the inline's font size — the resulting per-char width then scales
 * with `font.size`, mirroring the real Canvas behaviour.
 */
export class StubMeasurer implements TextMeasurer {
  constructor(
    readonly charWidth = 8,
    readonly opts: { respectFontSize?: boolean } = {},
  ) {}

  measureWidth(text: string, font: ResolvedFont): number {
    if (this.opts.respectFontSize) {
      return text.length * font.size;
    }
    return text.length * this.charWidth;
  }
}

export function stubMeasurer(charWidth = 8): StubMeasurer {
  return new StubMeasurer(charWidth);
}
