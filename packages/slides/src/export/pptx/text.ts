import type { Block, Inline } from '@wafflebase/docs';
import type { StoredColor } from '@wafflebase/docs';
import type { AutofitMode, TextBody, VerticalAnchorMode } from '../../model/element.js';
import { escapeXmlText } from './xml.js';
import { ptToHundredths } from './units.js';
import { colorChildXml, colorFromStringOrTheme } from './color.js';

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

function blockToXml(block: Block): string {
  const algn = ALGN[block.style.alignment] ?? 'l';
  const lvl = block.listLevel ? ` lvl="${block.listLevel}"` : '';
  let bu = '';
  if (block.listKind === 'ordered') bu = '<a:buAutoNum type="arabicPeriod"/>';
  else if (block.listKind === 'unordered') bu = '<a:buChar char="•"/>';
  const pPr = `<a:pPr algn="${algn}"${lvl}>${bu}</a:pPr>`;
  const runs = block.inlines.map(runToXml).join('');
  return `<a:p>${pPr}${runs}</a:p>`;
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
 * `colorFromStringOrTheme` already handles the `string → {kind:'srgb'}` case.
 * `StoredColor` and `ThemeColor` share the same `{kind:'srgb'|'role'}` shape,
 * so the cast is safe for both structured forms.
 */
function storedColorToThemeColor(c: StoredColor) {
  // colorFromStringOrTheme accepts string | ThemeColor. StoredColor is
  // string | {kind:'srgb'} | {kind:'role'} — all of which are ThemeColor-
  // compatible for the purposes of colorChildXml (same discriminated union).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return colorFromStringOrTheme(c as any);
}

function runToXml(inline: Inline): string {
  const s = inline.style;
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
  if (s.fontFamily) {
    children.push(`<a:latin typeface="${escapeXmlText(s.fontFamily)}"/>`);
  }
  if (s.href) {
    // Hyperlinks require a slide relationship id, which is wired up in a
    // later task. Emit a placeholder so round-trip normalization can strip
    // href from the comparison scope when not yet wired.
    children.push(`<a:hlinkClick r:id=""/>`);
  }
  const rPr =
    attrs.length || children.length
      ? `<a:rPr${attrs.length ? ' ' + attrs.join(' ') : ''}>${children.join('')}</a:rPr>`
      : `<a:rPr/>`;
  return `<a:r>${rPr}<a:t>${escapeXmlText(inline.text)}</a:t></a:r>`;
}
