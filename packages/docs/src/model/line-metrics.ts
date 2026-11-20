/**
 * One single line of text, measured from its first baseline: `above` is the
 * line top to the baseline, `below` the baseline to the line bottom. In em, so
 * a line of a 14.67 px font is `(above + below) × 14.67` px tall at spacing
 * 1.0.
 */
export interface SingleLineMetrics {
  above: number;
  below: number;
}

/**
 * How a layout host sizes one single line of a family. `computeLayout`
 * multiplies its result by the paragraph's line spacing, so a host that
 * supplies one gives line spacing the meaning Word, Google Docs and Google
 * Slides give it — a multiple of the font's single line — instead of CSS's
 * multiple of the font size. A host that supplies none keeps the CSS meaning.
 * See `docs-named-styles.md` § Leading is font-relative.
 */
export type SingleLineMetricsFn = (fontFamily: string | undefined) => SingleLineMetrics;
