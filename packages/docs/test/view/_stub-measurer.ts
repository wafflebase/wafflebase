import type { ResolvedFont, TextMeasurer } from '../../src/view/measurer.js';

/**
 * Deterministic measurer used by layout / pagination unit tests.
 *
 * Returns a fixed pixel width per character regardless of font, so tests
 * don't depend on jsdom's missing Canvas 2D context. The default 8 px
 * matches the long-standing `mockCtx` used across the docs test suite.
 *
 * The two modes are **mutually exclusive**:
 *   - default: every char measures `charWidth` px
 *   - `respectFontSize: true`: every char measures `font.size` px (the
 *     constructor's `charWidth` is ignored, since tests in this mode
 *     specifically care about how sup/sub scales the font size)
 *
 * `respectFontSize` mode mirrors the real Canvas behaviour where width
 * scales with the rendered font size — the only thing layout tests for
 * sup/sub need to verify.
 */
export class StubMeasurer implements TextMeasurer {
  constructor(
    readonly charWidth = 8,
    readonly opts: { respectFontSize?: boolean } = {},
  ) {}

  measureWidth(text: string, font: ResolvedFont): number {
    if (this.opts.respectFontSize) {
      // charWidth intentionally ignored in this mode — see class JSDoc.
      return text.length * font.size;
    }
    return text.length * this.charWidth;
  }
}

export function stubMeasurer(charWidth = 8): StubMeasurer {
  return new StubMeasurer(charWidth);
}
