import type { InlineStyle, BlockStyle } from '../model/types.js';
import { pointsToHalfPoints, pxToTwips } from '../import/units.js';

/**
 * Build <w:rPr>...</w:rPr> XML from InlineStyle.
 * Returns empty string if no properties to set.
 */
export function buildRunPropertiesXml(style: InlineStyle): string {
  const parts: string[] = [];

  if (style.fontFamily) {
    parts.push(`<w:rFonts w:ascii="${style.fontFamily}" w:hAnsi="${style.fontFamily}" w:eastAsia="${style.fontFamily}"/>`);
  }
  if (style.bold) parts.push('<w:b/>');
  if (style.italic) parts.push('<w:i/>');
  if (style.underline) parts.push('<w:u w:val="single"/>');
  if (style.strikethrough) parts.push('<w:strike/>');
  if (style.fontSize) {
    const hp = pointsToHalfPoints(style.fontSize);
    parts.push(`<w:sz w:val="${hp}"/>`);
    parts.push(`<w:szCs w:val="${hp}"/>`);
  }
  if (style.color) {
    const hex = style.color.replace('#', '');
    parts.push(`<w:color w:val="${hex}"/>`);
  }
  if (style.backgroundColor) {
    const hex = style.backgroundColor.replace('#', '');
    parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
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
