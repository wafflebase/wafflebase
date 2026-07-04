import type { Block, BlockMarker, Inline } from '@wafflebase/docs';
import type { StoredColor } from '@wafflebase/docs';
import type { AutofitMode, TextBody, VerticalAnchorMode } from '../../model/element.js';
import type { ColorRole, ThemeColor } from '../../model/theme.js';
import { escapeXmlText, escapeXmlAttr } from './xml.js';
import { ptToHundredths } from './units.js';
import { ROLE_TO_SCHEME, colorChildXml, colorFromStringOrTheme } from './color.js';

/**
 * Serialize a `TextBody` to an OOXML `<a:txBody>` or `<p:txBody>` element.
 *
 * @param body   The text body to serialize.
 * @param tag    The wrapper element tag. Shapes use `'p:txBody'`; table cells
 *               use `'a:txBody'`. Defaults to `'a:txBody'`.
 */
export function textBodyToXml(
  body: TextBody,
  tag: 'a:txBody' | 'p:txBody' = 'a:txBody',
): string {
  const paras = body.blocks.map(blockToXml).join('');
  return `<${tag}>${bodyPrXml(body.autofit, body.verticalAnchor)}${paras || '<a:p/>'}</${tag}>`;
}

function bodyPrXml(
  autofit: AutofitMode | undefined,
  anchor: VerticalAnchorMode | undefined,
): string {
  const anchorAttr =
    anchor === 'middle'
      ? ' anchor="ctr"'
      : anchor === 'bottom'
        ? ' anchor="b"'
        : anchor === 'top'
          ? ' anchor="t"'
          : '';
  const fit =
    autofit === 'none'
      ? '<a:noAutofit/>'
      : autofit === 'shrink'
        ? '<a:normAutofit/>'
        : '<a:spAutoFit/>';
  return `<a:bodyPr${anchorAttr}>${fit}</a:bodyPr>`;
}

const ALGN: Record<string, string> = {
  left: 'l',
  center: 'ctr',
  right: 'r',
  justify: 'just',
};

/**
 * EMU per pixel at 96 dpi (914400 EMU/in ÷ 96 px/in = 9525).
 * The importer converts marL/indent from EMU to px by dividing by this value,
 * so the exporter inverts it by multiplying.
 */
const EMU_PER_PX = 9525;

function blockToXml(block: Block): string {
  const algn = ALGN[block.style.alignment] ?? 'l';
  const lvl = block.listLevel ? ` lvl="${block.listLevel}"` : '';

  // marL / indent — importer reads attrInt(pPr,'marL') / 'indent' then
  // divides by 9525 (EMU→px). Invert: multiply by 9525 and emit only when non-zero.
  const marLAttr =
    block.style.marginLeft ? ` marL="${Math.round(block.style.marginLeft * EMU_PER_PX)}"` : '';
  const indentAttr =
    block.style.textIndent ? ` indent="${Math.round(block.style.textIndent * EMU_PER_PX)}"` : '';

  // lineHeight — importer reads <a:lnSpc><a:spcPct val> and divides by 100_000.
  // Invert: multiply by 100_000.
  const lnSpc =
    block.style.lineHeight != null
      ? `<a:lnSpc><a:spcPct val="${Math.round(block.style.lineHeight * 100_000)}"/></a:lnSpc>`
      : '';

  // spcBef / spcAft — importer reads <a:spcPts val> (hundredths of a point)
  // and scales by 96/72 into px. Invert: px → points × 100. Emit only when
  // non-zero (zero is the PPTX default). OOXML pPr order: lnSpc, spcBef, spcAft.
  const spcBef = block.style.marginTop
    ? `<a:spcBef><a:spcPts val="${Math.round((block.style.marginTop * 72) / 96 * 100)}"/></a:spcBef>`
    : '';
  const spcAft = block.style.marginBottom
    ? `<a:spcAft><a:spcPts val="${Math.round((block.style.marginBottom * 72) / 96 * 100)}"/></a:spcAft>`
    : '';

  // Bullet marker style — emit buClr, buSzPts, buFont BEFORE buAutoNum/buChar
  // per OOXML pPr child order. Only meaningful on list items; only emit when present.
  const markerXml = block.listKind ? markerToXml(block.marker) : '';

  let buType = '';
  if (block.listKind === 'ordered') buType = '<a:buAutoNum type="arabicPeriod"/>';
  else if (block.listKind === 'unordered') buType = '<a:buChar char="•"/>';

  const pPr = `<a:pPr algn="${algn}"${lvl}${marLAttr}${indentAttr}>${lnSpc}${spcBef}${spcAft}${markerXml}${buType}</a:pPr>`;
  const runs = block.inlines.map(runToXml).join('');
  return `<a:p>${pPr}${runs}</a:p>`;
}

/**
 * Emit bullet marker styling children for `<a:pPr>`.
 *
 * OOXML pPr child order for bullet style: buClr → buSzPts → buFont.
 * The importer reads:
 *   - `<a:buFont typeface>` → marker.fontFamily
 *   - `<a:buSzPts val>` / 100 → marker.fontSize (val is hundredths of a point)
 *   - `<a:buClr>` color → marker.color
 */
function markerToXml(marker: BlockMarker | undefined): string {
  if (!marker) return '';
  const parts: string[] = [];

  // buClr — importer reads parseColorFromContainer(buClr, clrMap) → marker.color
  if (marker.color != null) {
    parts.push(
      `<a:buClr>${colorChildXml(storedColorToThemeColor(marker.color))}</a:buClr>`,
    );
  }

  // buSzPts — importer reads attrInt(buSzPts,'val') / 100 → marker.fontSize (pts)
  // Invert: multiply by 100 for hundredths-of-a-point.
  if (marker.fontSize != null && marker.fontSize > 0) {
    parts.push(`<a:buSzPts val="${Math.round(marker.fontSize * 100)}"/>`);
  }

  // buFont — importer reads attr(buFont,'typeface') → marker.fontFamily
  if (marker.fontFamily) {
    parts.push(`<a:buFont typeface="${escapeXmlAttr(marker.fontFamily)}"/>`);
  }

  return parts.join('');
}

/**
 * Convert a `StoredColor` (which may be a plain hex string, an `{kind:'srgb'}`
 * object, or a `{kind:'role'}` theme reference) to the `ThemeColor` expected
 * by `colorChildXml`.
 *
 * The inverse of what `src/import/pptx/text.ts` does:
 *   - `<a:srgbClr val="…">` → `{ kind: 'srgb', value: '#RRGGBB' }` or a bare
 *     hex string (`'#RRGGBB'`).
 *   - `<a:schemeClr val="…">` → `{ kind: 'role', role: '…' }`.
 *
 * `StoredColor`'s role arm uses `role: string` (open), while `ThemeColor`'s
 * role arm uses `role: ColorRole` (closed, 12 values). An out-of-set role
 * string would make `colorChildXml` emit `<a:schemeClr val="undefined"/>`.
 * We validate the role against `ROLE_TO_SCHEME` keys and fall back to black
 * for any unrecognised value.
 */
function storedColorToThemeColor(c: StoredColor): ThemeColor {
  if (typeof c === 'string') return colorFromStringOrTheme(c);
  if (c.kind === 'srgb') return { kind: 'srgb', value: c.value };
  // role arm: validate against the closed ColorRole set before casting
  if ((Object.keys(ROLE_TO_SCHEME) as string[]).includes(c.role)) {
    const out: ThemeColor = { kind: 'role', role: c.role as ColorRole };
    if (c.tint !== undefined) out.tint = c.tint;
    if (c.shade !== undefined) out.shade = c.shade;
    return out;
  }
  // Unknown role — emit black rather than a broken `val="undefined"` attribute
  return { kind: 'srgb', value: '#000000' };
}

function runToXml(inline: Inline): string {
  const rPr = rPrXml(inline.style);
  // Soft line breaks (`\n`, imported from `<a:br>`) must round-trip back to
  // `<a:br>`, not a literal newline in `<a:t>` — PowerPoint collapses raw
  // newlines as insignificant whitespace, losing the break. Split on `\n`
  // and emit an `<a:br>` (carrying the run's props) between text segments.
  if (inline.text.includes('\n')) {
    const segs = inline.text.split('\n');
    const parts: string[] = [];
    segs.forEach((seg, i) => {
      if (i > 0) parts.push(`<a:br>${rPr}</a:br>`);
      if (seg) parts.push(`<a:r>${rPr}<a:t>${escapeXmlText(seg)}</a:t></a:r>`);
    });
    return parts.join('');
  }
  return `<a:r>${rPr}<a:t>${escapeXmlText(inline.text)}</a:t></a:r>`;
}

/** Build the `<a:rPr>` node for a run/break from an inline style. */
function rPrXml(s: Inline['style']): string {
  const attrs: string[] = [];
  if (s.bold) attrs.push('b="1"');
  if (s.italic) attrs.push('i="1"');
  if (s.underline) attrs.push('u="sng"');
  if (s.strikethrough) attrs.push('strike="sngStrike"');
  if (s.fontSize != null) attrs.push(`sz="${ptToHundredths(s.fontSize)}"`);
  const children: string[] = [];
  if (s.color != null) {
    children.push(
      `<a:solidFill>${colorChildXml(storedColorToThemeColor(s.color))}</a:solidFill>`,
    );
  }
  // backgroundColor → <a:highlight> — importer reads parseColorFromContainer(highlight, clrMap)
  // → style.backgroundColor. Use the same colorChildXml bridge already used for style.color.
  if (s.backgroundColor != null) {
    children.push(
      `<a:highlight>${colorChildXml(storedColorToThemeColor(s.backgroundColor))}</a:highlight>`,
    );
  }
  if (s.fontFamily) {
    children.push(`<a:latin typeface="${escapeXmlAttr(s.fontFamily)}"/>`);
  }
  // s.href: hyperlink wiring is deferred (Phase 2). Do not emit any
  // <a:hlinkClick> node — an empty r:id="" produces an invalid relationship.
  return attrs.length || children.length
    ? `<a:rPr${attrs.length ? ' ' + attrs.join(' ') : ''}>${children.join('')}</a:rPr>`
    : `<a:rPr/>`;
}
