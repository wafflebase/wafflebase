import type { SingleLineMetrics, SingleLineMetricsFn } from '../model/line-metrics.js';
import { FONT_LINE_METRICS } from './font-metrics.data.js';

/**
 * Arial's line, for a family the table does not know. Arial is the default
 * font, and Hangul typed in an unknown or Latin-only family still takes that
 * family's line in Google Docs (measured), not its fallback glyph's.
 */
const FALLBACK: SingleLineMetrics = toMetrics(FONT_LINE_METRICS.arial);

/**
 * A `Map`, not the generated object, because the key is a peer-written
 * `fontFamily`: indexing a plain object with `constructor` or `__proto__`
 * walks the prototype chain and hands back a function, which would throw on
 * every layout pass of the document.
 */
const METRICS = new Map<string, SingleLineMetrics>(
  Object.entries(FONT_LINE_METRICS).map(([family, entry]) => [family, toMetrics(entry)]),
);

function toMetrics([above, below]: readonly [number, number]): SingleLineMetrics {
  return { above, below };
}

/** The first family of a CSS-style list, unquoted and lowercased. */
function primaryFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

/**
 * Google Docs' single line for a family: its normal line height (CJK fonts
 * 1.3× that), from the build-time table in `font-metrics.data.ts`. The table
 * rather than a runtime `measureText()` read because the docs layout runs in
 * the browser, in Node and before web fonts finish loading, and all three must
 * agree on where a page breaks.
 */
export const docsSingleLineMetrics: SingleLineMetricsFn = (fontFamily) => {
  if (!fontFamily) return FALLBACK;
  return METRICS.get(primaryFamily(fontFamily)) ?? FALLBACK;
};
