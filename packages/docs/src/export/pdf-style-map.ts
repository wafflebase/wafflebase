import type { InlineStyle } from '../model/types.js';
import type { StoredColor } from '../model/color.js';
import { defaultColorResolver } from '../model/color.js';
import { customFontKey, type PdfFontKey } from './pdf-fonts.js';

// "Latin-safe" character class: code points pdf-lib's WinAnsi-encoded
// StandardFonts (Helvetica, Times, Courier) can encode without throwing.
// Everything outside this set — Korean, Japanese, Chinese, CJK punctuation
// like ※, 「」, geometric shapes (●○■), etc. — must route through the
// embedded Korean font that carries those glyphs.
//
// Coverage: Basic Latin + Latin-1 Supplement (U+0000–U+00FF) plus the
// individual code points WinAnsi additionally encodes via the standard
// PDF text-state encoding table.
//
// The U+2018–U+201E quote block is enumerated as U+2018–U+201A and
// U+201C–U+201E so U+201B (reversed-9 quote) is *excluded*: CP1252 has no
// slot for it, so the StandardFonts throw on it — it must route to the
// embedded Korean font instead. Keep this in sync with `pdf-fonts.ts`.
const LATIN_SAFE_CHARS = '\\u0000-\\u00FF\\u0152\\u0153\\u0160\\u0161\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201A\\u201C-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122';
const NEEDS_CJK_FONT = new RegExp(`[^${LATIN_SAFE_CHARS}]`);
const SCRIPT_SPLIT = new RegExp(
  `[^${LATIN_SAFE_CHARS}]+|[${LATIN_SAFE_CHARS}]+`,
  'g',
);
const SERIF_FAMILIES = new Set([
  '바탕', 'Batang', 'Noto Serif KR',
  'Times New Roman', 'Times', 'Georgia',
]);

export interface ScriptSegment {
  text: string;
  /**
   * True when this segment must be drawn with the embedded Korean font
   * because at least one character is outside pdf-lib's WinAnsi-encoded
   * StandardFonts. Despite the name, this also covers Cyrillic, Arabic,
   * emoji, etc. — anything not in Latin-1 + WinAnsi specials. Those
   * scripts will render as `.notdef` glyphs (boxes) since Noto KR only
   * carries Korean + CJK + basic Latin; full Unicode coverage is a
   * separate font-strategy task.
   */
  needsCustomFont: boolean;
}

/**
 * Split a string into runs that need the CJK-capable embedded font vs
 * those the WinAnsi-encoded StandardFonts can render. The classification
 * key is whether each character can be encoded by Helvetica/Times — not
 * a strict "is this Hangul" check — so CJK punctuation (※, 「」) and
 * geometric shapes (●○■) route correctly.
 *
 * C0 control characters (\n, \r, \t, etc.), DEL, and the C1 controls
 * (U+0080–U+009F) are stripped: WinAnsi has no encoding for them and they
 * have no visual representation at draw time. The C1 block sits inside the
 * "Latin-safe" U+0000–U+00FF range, so without this strip a pasted C1 byte
 * would route to a StandardFont and throw "WinAnsi cannot encode" — taking
 * the whole export down. Layout/pagination already breaks lines at logical
 * boundaries, so any control char surviving into a `LayoutRun.text` is a
 * paste-time artifact we can drop without losing meaning.
 *
 * IMPORTANT: U+FFFC (Object Replacement Character) is the placeholder
 * text for image inlines and MUST NOT be added to the strip range here.
 * Image runs are handled in `pdf-painter.ts:paintRun` before
 * `splitMixedScript` is called, but the `LayoutRun.text` for an image
 * still carries U+FFFC, and stripping it here would shift width
 * measurements and run advance calculations.
 */
export function splitMixedScript(text: string): ScriptSegment[] {
  if (!text) return [];
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  if (!cleaned) return [];
  const segments: ScriptSegment[] = [];
  for (const match of cleaned.matchAll(SCRIPT_SPLIT)) {
    const seg = match[0];
    segments.push({ text: seg, needsCustomFont: NEEDS_CJK_FONT.test(seg) });
  }
  return segments;
}

/**
 * Map an InlineStyle + script flag to an embedded PDF font key.
 *
 * For Latin text in a curated Google Font (`embeddable` carries the
 * families that were actually embedded), returns a per-family `custom:`
 * key. Otherwise falls back to one of the 12 standard/Korean keys.
 *
 * Korean and custom italics fall back to the regular cut (no italic face
 * is embedded). Use `isItalicShim` to know when to apply a manual oblique
 * transform.
 */
export function resolveFontKey(
  style: InlineStyle,
  needsCustomFont: boolean,
  embeddable?: ReadonlySet<string>,
): PdfFontKey {
  const family = style.fontFamily ?? 'Arial';
  const isSerif = SERIF_FAMILIES.has(family);
  const isBold = !!style.bold;
  const isItalic = !!style.italic;
  // Latin segments of a curated, successfully-embedded Google Font use the
  // real face. CJK segments (`needsCustomFont`) still route to Noto below.
  if (!needsCustomFont && embeddable?.has(family)) {
    return customFontKey(family, isBold);
  }
  if (needsCustomFont) {
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
 * resolved font has no italic variant — the Korean Noto faces and the
 * custom Google Font embeds (which only ship regular + bold).
 */
export function isItalicShim(
  style: InlineStyle,
  needsCustomFont: boolean,
  embeddable?: ReadonlySet<string>,
): boolean {
  if (!style.italic) return false;
  if (needsCustomFont) return true;
  return !!embeddable?.has(style.fontFamily ?? 'Arial');
}

/**
 * Parse a "#RRGGBB" color into pdf-lib `rgb()` components in [0, 1].
 * Returns black for invalid or missing values. Accepts a `StoredColor`
 * for callers that read from `InlineStyle.color`/`backgroundColor`; the
 * legacy `string | undefined` shape stays valid because `string ⊂ StoredColor`.
 */
export function styleColor(hex: StoredColor | undefined): { r: number; g: number; b: number } {
  const resolved = defaultColorResolver(hex);
  if (!resolved) return { r: 0, g: 0, b: 0 };
  const m = /^#?([0-9a-f]{6})$/i.exec(resolved.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}
