import type { InlineStyle, BlockStyle } from '../model/types.js';
import { defaultColorResolver, toRgbHexColor } from '../model/color.js';
import { pointsToHalfPoints, pxToTwips } from '../import/units.js';
import { isKoreanCapableFamily } from '../view/fonts.js';

/**
 * Default Latin face the docs view paints unstyled runs with — kept in
 * sync with `Theme.defaultFontFamily`. Duplicated here (rather than
 * imported) so the DOCX exporter stays free of the browser-only view
 * module (palette tokens, Canvas APIs).
 */
const DEFAULT_LATIN_FAMILY = 'Arial';
const DEFAULT_EAST_ASIAN_FAMILY = 'Noto Sans KR';

/**
 * Escape a value for safe interpolation into a double-quoted XML
 * attribute. Style values like `fontFamily` and `color` originate from
 * untrusted sources (PPTX/DOCX imports, user input in the font picker),
 * so a hostile family name like `A"><script>` could break the DOCX
 * `<w:rFonts>` element or inject attributes. The five canonical replacements cover
 * every reserved character inside attribute content per the XML 1.0
 * spec — applied to `&` first so subsequent escapes don't get
 * re-escaped.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalize a color string into an OOXML `ST_HexColor` value (six hex
 * digits, no leading `#`), or `undefined` when it cannot be expressed as
 * one — in which case the caller drops the attribute and the run inherits
 * the document default rather than carrying a broken value.
 *
 * DOCX-facing name for the shared `toRgbHexColor` normalizer: `w:color`
 * (`ST_HexColor`) and PPTX's `<a:srgbClr val>` (`ST_HexColorRGB`) need the
 * same six-digit triplet from the same untrusted `StoredColor` strings, so
 * both sinks share one implementation in `model/color.ts` (including its
 * fully-transparent → `undefined` rule: `w:shd` has no alpha, so an
 * `rgba(0,0,0,0)` paste must not become an opaque black block).
 */
export function toDocxHexColor(color: string | undefined): string | undefined {
  return toRgbHexColor(color);
}

/**
 * Build <w:rPr>...</w:rPr> XML from InlineStyle.
 * Returns empty string if no properties to set.
 */
export function buildRunPropertiesXml(style: InlineStyle): string {
  const parts: string[] = [];

  // Always emit `<w:rFonts>` so DOCX viewers (Word, LibreOffice, Pages)
  // pick up the same East Asian face the docs view paints. Previously
  // we skipped the override when `style.fontFamily` was undefined,
  // which left Word to render Hangul runs in the document default
  // (typically Calibri) — but Wafflebase paints those runs through the
  // theme default + Noto Sans KR fallback. Defaulting the EA slot
  // separately keeps Latin runs unchanged while making Hangul render
  // with Noto Sans KR in Word.
  const ascii = style.fontFamily ?? DEFAULT_LATIN_FAMILY;
  const eastAsia = style.fontFamily && isKoreanCapableFamily(style.fontFamily)
    ? style.fontFamily
    : DEFAULT_EAST_ASIAN_FAMILY;
  const asciiAttr = escapeXmlAttr(ascii);
  const eastAsiaAttr = escapeXmlAttr(eastAsia);
  parts.push(
    `<w:rFonts w:ascii="${asciiAttr}" w:hAnsi="${asciiAttr}" w:eastAsia="${eastAsiaAttr}"/>`,
  );
  if (style.bold) parts.push('<w:b/>');
  if (style.italic) parts.push('<w:i/>');
  if (style.underline) parts.push('<w:u w:val="single"/>');
  if (style.strikethrough) parts.push('<w:strike/>');
  if (style.fontSize) {
    const hp = pointsToHalfPoints(style.fontSize);
    parts.push(`<w:sz w:val="${hp}"/>`);
    parts.push(`<w:szCs w:val="${hp}"/>`);
  }
  // DOCX export resolves theme colors through the default resolver:
  // role-bound colors are dropped (no theme registered at the docs
  // layer), srgb/string forms render verbatim. Slides decks that need
  // role-aware DOCX would have to flatten themes before export.
  //
  // `defaultColorResolver` passes any string through untouched, and
  // `InlineStyle.color` really can hold a non-palette string (DOCX/PPTX
  // import, HTML paste, the legacy `''` reset of issue #728), so run it
  // through `toDocxHexColor`: anything that is not expressible as an
  // `ST_HexColor` is dropped instead of emitted verbatim, which keeps the
  // attribute both schema-valid and injection-proof.
  const colorHex = toDocxHexColor(defaultColorResolver(style.color));
  if (colorHex) {
    parts.push(`<w:color w:val="${colorHex}"/>`);
  }
  const bgHex = toDocxHexColor(defaultColorResolver(style.backgroundColor));
  if (bgHex) {
    parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${bgHex}"/>`);
  }
  if (style.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  if (style.subscript) parts.push('<w:vertAlign w:val="subscript"/>');

  if (parts.length === 0) return '';
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

/**
 * `BlockStyle.alignment` → OOXML `ST_Jc` token. A closed map, so an
 * unrecognized value falls back to the paragraph default instead of being
 * interpolated into the `w:val` attribute.
 */
const DOCX_ALIGNMENTS: Record<string, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
};

/**
 * Build <w:pPr>...</w:pPr> XML from BlockStyle.
 */
export function buildParagraphPropertiesXml(
  style: BlockStyle,
  headingLevel?: number,
): string {
  const parts: string[] = [];

  if (headingLevel) {
    parts.push(`<w:pStyle w:val="Heading${headingLevel}"/>`);
  }

  // `BlockStyle.alignment` is typed, but the value reaching an exporter is
  // whatever string was persisted into the CRDT (DOCX/PPTX import, the
  // content PUT API, an older schema), so it is untrusted at this sink the
  // same way colors are. Resolve it through a closed lookup — mirroring the
  // PPTX exporter's `ALGN[...] ?? 'l'` — so `<w:jc w:val>` can only ever
  // carry an `ST_Jc` token and never an attacker-chosen fragment.
  const align = DOCX_ALIGNMENTS[style.alignment as string] ?? 'left';
  if (align !== 'left') {
    parts.push(`<w:jc w:val="${align}"/>`);
  }

  const spacingParts: string[] = [];
  if (style.marginTop > 0) spacingParts.push(`w:before="${pxToTwips(style.marginTop)}"`);
  if (style.marginBottom > 0) spacingParts.push(`w:after="${pxToTwips(style.marginBottom)}"`);
  if (style.lineHeight !== 1.5) spacingParts.push(`w:line="${Math.round(style.lineHeight * 240)}"`);
  if (spacingParts.length > 0) parts.push(`<w:spacing ${spacingParts.join(' ')}/>`);

  const indParts: string[] = [];
  if (style.textIndent > 0) indParts.push(`w:firstLine="${pxToTwips(style.textIndent)}"`);
  if (style.marginLeft > 0) indParts.push(`w:left="${pxToTwips(style.marginLeft)}"`);
  if (indParts.length > 0) parts.push(`<w:ind ${indParts.join(' ')}/>`);

  if (parts.length === 0) return '';
  return `<w:pPr>${parts.join('')}</w:pPr>`;
}
