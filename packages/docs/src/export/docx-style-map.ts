import type { InlineStyle, BlockStyle } from '../model/types.js';
import { defaultColorResolver } from '../model/color.js';
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
 * one.
 *
 * Escaping alone is not enough for `w:color/@w:val` and `w:shd/@w:fill`:
 * those attributes are typed `ST_HexColor`, but `InlineStyle.color` and a
 * table cell's `backgroundColor` hold whatever string reached the model.
 * The HTML-paste path (`view/clipboard.ts`) copies browser-normalized CSS
 * verbatim, so `rgb(255, 0, 0)` is routine; DOCX/PPTX import and the
 * legacy `''` reset of issue #728 add more non-hex shapes. Emitting those
 * verbatim yields a schema-invalid document Word refuses to open, so the
 * recognized CSS forms are converted and everything else drops the
 * attribute (the run inherits the document default) rather than writing a
 * broken one.
 *
 * Returning only `[0-9A-F]{6}` also makes these attributes injection-proof
 * by construction — the validation subsumes `escapeXmlAttr`.
 */
export function toDocxHexColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const v = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  // #RGB shorthand — expand each nibble (CSS rule: #abc === #aabbcc).
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    return v.split('').map((ch) => ch + ch).join('').toUpperCase();
  }
  // #RRGGBBAA — DOCX has no per-run alpha, so keep the RGB and drop it.
  if (/^[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 6).toUpperCase();
  // Channels accept a sign so an out-of-gamut `rgb(300, -5, 0)` clamps
  // below instead of falling through to "not a color" and dropping a
  // background the user can see.
  const rgb = /^rgba?\(\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*(?:,[^)]*)?\)$/i.exec(v);
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((n) =>
      Math.max(0, Math.min(255, Math.round(Number(n)))),
    );
    if (channels.some((n) => Number.isNaN(n))) return undefined;
    return channels.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return undefined;
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

  const align = style.alignment === 'justify' ? 'both' : style.alignment;
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
