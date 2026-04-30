import type { InlineStyle } from '../model/types.js';
import type { PdfFontKey } from './pdf-fonts.js';

const KR_RANGE_GLOBAL = /[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]+|[^\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]+/g;
const KR_RANGE = /[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
const SERIF_FAMILIES = new Set([
  '바탕', 'Batang', 'Noto Serif KR',
  'Times New Roman', 'Times', 'Georgia',
]);

export interface ScriptSegment {
  text: string;
  isCJK: boolean;
}

/**
 * Split a string into runs of CJK and non-CJK so the painter can use
 * different fonts per segment (Helvetica for Latin, Noto KR for CJK).
 */
export function splitMixedScript(text: string): ScriptSegment[] {
  if (!text) return [];
  const segments: ScriptSegment[] = [];
  for (const match of text.matchAll(KR_RANGE_GLOBAL)) {
    const seg = match[0];
    segments.push({ text: seg, isCJK: KR_RANGE.test(seg) });
  }
  return segments;
}

/**
 * Map an InlineStyle + script flag to one of the 12 embedded PDF fonts.
 *
 * Korean italic falls back to regular (Noto KR has no italic). Use
 * `isItalicShim` to know when to apply a manual oblique transform.
 */
export function resolveFontKey(style: InlineStyle, isCJK: boolean): PdfFontKey {
  const isSerif = SERIF_FAMILIES.has(style.fontFamily ?? 'Arial');
  const isBold = !!style.bold;
  const isItalic = !!style.italic;
  if (isCJK) {
    if (isSerif) return isBold ? 'kr-serif-bold' : 'kr-serif-regular';
    return isBold ? 'kr-sans-bold' : 'kr-sans-regular';
  }
  if (isSerif) {
    if (isBold && isItalic) return 'serif-boldItalic';
    if (isBold) return 'serif-bold';
    if (isItalic) return 'serif-italic';
    return 'serif-regular';
  }
  if (isBold && isItalic) return 'sans-boldItalic';
  if (isBold) return 'sans-bold';
  if (isItalic) return 'sans-italic';
  return 'sans-regular';
}

/**
 * True when the painter must apply an oblique transform because the
 * resolved Korean font has no italic variant.
 */
export function isItalicShim(style: InlineStyle, isCJK: boolean): boolean {
  return !!style.italic && isCJK;
}

/**
 * Parse a "#RRGGBB" color into pdf-lib `rgb()` components in [0, 1].
 * Returns black for invalid or missing values.
 */
export function styleColor(hex: string | undefined): { r: number; g: number; b: number } {
  if (!hex) return { r: 0, g: 0, b: 0 };
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}
