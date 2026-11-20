import type { SingleLineMetrics, SingleLineMetricsFn } from '../model/line-metrics.js';
import { FONT_LINE_METRICS } from './font-metrics.data.js';
import { fontFamilyCandidates } from './fonts.js';

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

/** The first family of a CSS-style list, unquoted. */
function primaryFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

/**
 * Memo per stored family string. The input set is a document's distinct
 * `fontFamily` values, and this runs once per run per line on every layout,
 * so the alias walk is paid once per family rather than per run.
 */
const RESOLVED = new Map<string, SingleLineMetrics>();
const RESOLVED_LIMIT = 512;

/**
 * Google Docs' single line for a family: its normal line height (CJK fonts
 * 1.3× that), from the build-time table in `font-metrics.data.ts`. The table
 * rather than a runtime `measureText()` read because the docs layout runs in
 * the browser, in Node and before web fonts finish loading, and all three must
 * agree on where a page breaks.
 */
export const docsSingleLineMetrics: SingleLineMetricsFn = (fontFamily) => {
  if (!fontFamily) return FALLBACK;
  const memo = RESOLVED.get(fontFamily);
  if (memo) return memo;
  // The same alias and suffix resolution the painter's font stack goes
  // through, so a stored `'Gothic A1 Bold'` or `'맑은 고딕'` sizes from the
  // face that is drawn rather than from Arial.
  let found = FALLBACK;
  for (const name of fontFamilyCandidates(primaryFamily(fontFamily))) {
    const m = METRICS.get(name.toLowerCase());
    if (m) {
      found = m;
      break;
    }
  }
  // Bounded: family strings come from peers, and a document that cycled
  // through unbounded distinct names must not grow this without limit.
  if (RESOLVED.size >= RESOLVED_LIMIT) RESOLVED.clear();
  RESOLVED.set(fontFamily, found);
  return found;
};
