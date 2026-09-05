import { DEFAULT_BLOCK_STYLE } from '../model/types.js';
import type { InlineStyle, BlockStyle } from '../model/types.js';
import { defaultColorResolver, toRgbHexColor } from '../model/color.js';
import { pointsToHalfPoints, pxToTwips } from '../import/units.js';
import { isKoreanCapableFamily } from '../view/fonts.js';
import { LIST_PARAGRAPH_STYLE_ID } from './docx-templates.js';

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
 * `BlockStyle.alignment` → OOXML `ST_Jc` token. A `Map`, not an object
 * literal: an object lookup consults the prototype chain, so an alignment of
 * `toString` / `constructor` / `valueOf` would resolve to an inherited
 * `Object.prototype` member, survive the `?? 'left'` fallback and be
 * stringified into the `w:val` attribute. `Map.get` only ever returns an own
 * entry, which is what makes this lookup actually closed.
 */
const DOCX_ALIGNMENTS = new Map<string, string>([
  ['left', 'left'],
  ['center', 'center'],
  ['right', 'right'],
  ['justify', 'both'],
]);

/**
 * `Block.headingLevel` → the `HeadingN` style id `<w:pStyle w:val>` carries.
 *
 * `headingLevel` is typed as `HeadingLevel` (1–6) but reaches this exporter as
 * whatever was persisted into the CRDT (DOCX/PPTX import, the content PUT API,
 * an older schema), exactly like `alignment` and the colors below — and both
 * CRDT readers coerce it with `Number(...)`, which yields `NaN` rather than
 * failing, so nothing upstream guarantees a value in range. Interpolating it
 * raw would let a hostile string close the attribute and inject its own
 * WordprocessingML into the exported `.docx`. Resolve it to one of the six
 * built-in `HeadingN` style ids Word knows (matching `HeadingLevel`), or to
 * `undefined` so the caller drops the element and the paragraph exports
 * unstyled rather than broken.
 */
function toHeadingStyleId(headingLevel: number | undefined): string | undefined {
  if (headingLevel === undefined) return undefined;
  const n = Number(headingLevel);
  if (!Number.isInteger(n) || n < 1 || n > 6) return undefined;
  return `Heading${n}`;
}

/**
 * Build <w:pPr>...</w:pPr> XML from BlockStyle.
 */
export function buildParagraphPropertiesXml(
  style: BlockStyle,
  headingLevel?: number,
  opts?: {
    /**
     * This paragraph is a `list-item`. Emits `<w:pStyle w:val="ListParagraph"/>`
     * **and** `<w:contextualSpacing/>` — the pair, never one without the other.
     *
     * `<w:contextualSpacing/>` is Word's "Don't add space between paragraphs of
     * the same style", and it is how the editor's contextual list rhythm
     * survives an export: Word applies the rule natively, so the list keeps the
     * space around it and loses none of it between the bullets, and a bullet
     * inserted or deleted *in Word* re-resolves without a stale baked-in number.
     *
     * The style is what makes the rule mean the right thing. ECMA-376 §17.3.1.9
     * scopes it to paragraphs of the *same style*, and this exporter gives body
     * paragraphs no `<w:pStyle>` at all — so on the plain `Normal` everything
     * used to be, a list item's `<w:contextualSpacing/>` also suppressed its
     * space-after against the paragraph *following the list*: 8 px on screen, 0
     * in Word. A distinct style id is the whole fix; `ListParagraph` is defined
     * in `docx-templates.ts` with no metrics of its own, so it costs nothing but
     * the identity.
     *
     * A `list-item` never carries a `headingLevel` (`Block.type` is one or the
     * other), but if a corrupt document produced both, the heading style wins
     * below — two `<w:pStyle>` elements in one `<w:pPr>` is schema-invalid and
     * Word rejects the file, which is a worse failure than a mis-spaced bullet.
     */
    listItem?: boolean;
  },
): string {
  const parts: string[] = [];

  const headingStyleId = toHeadingStyleId(headingLevel);
  if (headingStyleId) {
    parts.push(`<w:pStyle w:val="${headingStyleId}"/>`);
  } else if (opts?.listItem) {
    parts.push(`<w:pStyle w:val="${LIST_PARAGRAPH_STYLE_ID}"/>`);
  }

  // `BlockStyle.alignment` is typed, but the value reaching an exporter is
  // whatever string was persisted into the CRDT (DOCX/PPTX import, the
  // content PUT API, an older schema), so it is untrusted at this sink the
  // same way colors are. Resolve it through a closed lookup — mirroring the
  // PPTX exporter's `ALGN[...] ?? 'l'` — so `<w:jc w:val>` can only ever
  // carry an `ST_Jc` token and never an attacker-chosen fragment.
  const align = DOCX_ALIGNMENTS.get(style.alignment as string) ?? 'left';
  if (align !== 'left') {
    parts.push(`<w:jc w:val="${align}"/>`);
  }

  // Deliberately raw `block.style`, *not* the named-style-resolved spacing the
  // screen now lays out with (`effectiveBlockSpacing`). A heading already
  // carries `<w:pStyle w:val="HeadingN"/>` above, so Word applies its own
  // Heading N space-before; emitting ours on top of it would double the gap
  // for every heading in every exported file. What direct `<w:spacing>` means
  // here stays "spacing this paragraph overrode", which is Word's own model.
  // Each field is emitted when the paragraph *authored* it, or — for a block
  // with no marker — when the value differs from what a style-unaware writer
  // would have produced, which is the same value sentinel
  // `effectiveBlockSpacing` falls back to. The two conditions mean the same
  // thing by construction rather than by coincidence.
  //
  // Carrying the marker here is not optional garnish: without it an authored
  // `lineHeight: 1.5` on a Heading 1 exports to nothing (1.5 *is*
  // `DEFAULT_BLOCK_STYLE.lineHeight`) and re-imports as the style's 1.2, and an
  // authored `marginTop: 0` exports to nothing and re-imports as 27 — one
  // export→import cycle would destroy exactly the distinction the marker
  // exists to record. ECMA-376 can express both: `CT_Spacing/@w:before` is a
  // `ST_TwipsMeasure` for which `0` is a valid explicit value, and direct
  // paragraph formatting outranks the paragraph style.
  //
  // `||` rather than `??` on purpose: a *cleared* marker (`false`, written by
  // `materializeBlockSpacing`) still falls through to the value check, so a
  // materialized Heading 1 keeps exporting the `w:before="405"` it exports
  // today. That output is arguably wrong — it lands on top of Word's own
  // Heading 1 space-before and doubles the gap — but it is pre-existing, it
  // changes every heading in every exported file, and it deserves its own
  // baselines rather than riding in as a side effect. `||` keeps this change a
  // pure superset of what was emitted before: it only adds the authored-zero
  // and authored-default cases. The principled rule the marker unlocks
  // ("emit direct `<w:spacing>` only when the paragraph authored it", i.e.
  // `??`) is the follow-up.
  const spacingParts: string[] = [];
  if (style.authoredMarginTop || style.marginTop > 0) {
    spacingParts.push(`w:before="${pxToTwips(style.marginTop)}"`);
  }
  if (style.authoredMarginBottom || style.marginBottom > 0) {
    spacingParts.push(`w:after="${pxToTwips(style.marginBottom)}"`);
  }
  if (style.authoredLineHeight || style.lineHeight !== DEFAULT_BLOCK_STYLE.lineHeight) {
    // `w:lineRule` is written explicitly even though `auto` is ECMA-376's
    // default for the attribute: `w:line` now goes out in strictly more cases,
    // Word itself always writes the rule, and the importer's `w:line / 240`
    // only makes sense under `auto`.
    spacingParts.push(`w:line="${Math.round(style.lineHeight * 240)}" w:lineRule="auto"`);
  }
  if (spacingParts.length > 0) parts.push(`<w:spacing ${spacingParts.join(' ')}/>`);

  const indParts: string[] = [];
  if (style.textIndent > 0) indParts.push(`w:firstLine="${pxToTwips(style.textIndent)}"`);
  if (style.marginLeft > 0) indParts.push(`w:left="${pxToTwips(style.marginLeft)}"`);
  if (indParts.length > 0) parts.push(`<w:ind ${indParts.join(' ')}/>`);

  // After `<w:ind>`, which is where `CT_PPr`'s element sequence puts it
  // (…`w:spacing`, `w:ind`, `w:contextualSpacing`, …). `<w:jc>` above is
  // out of sequence for the same schema — it belongs after this element — but
  // that ordering is what every file this exporter has already shipped
  // carries, so straightening it is a separate change with its own baselines.
  // A newly added element gets its correct slot rather than inheriting that.
  if (opts?.listItem) parts.push('<w:contextualSpacing/>');

  if (parts.length === 0) return '';
  return `<w:pPr>${parts.join('')}</w:pPr>`;
}
