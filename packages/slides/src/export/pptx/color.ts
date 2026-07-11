import { representativeColor, type ColorRole, type Fill, type GradientFill, type ThemeColor } from '../../model/theme';
import { escapeXmlAttr } from './xml.js';

export const ROLE_TO_SCHEME: Record<ColorRole, string> = {
  text: 'tx1',
  background: 'bg1',
  textSecondary: 'tx2',
  backgroundAlt: 'bg2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  visitedHyperlink: 'folHlink',
};

export function colorFromStringOrTheme(c: ThemeColor | string): ThemeColor {
  return typeof c === 'string' ? { kind: 'srgb', value: c } : c;
}

export function colorChildXml(c: ThemeColor): string {
  const mods: string[] = [];
  if ('lumMod' in c && c.lumMod !== undefined) mods.push(`<a:lumMod val="${c.lumMod}"/>`);
  if ('lumOff' in c && c.lumOff !== undefined) mods.push(`<a:lumOff val="${c.lumOff}"/>`);
  if ('tint' in c && c.tint !== undefined) mods.push(`<a:tint val="${c.tint}"/>`);
  if ('shade' in c && c.shade !== undefined) mods.push(`<a:shade val="${c.shade}"/>`);
  if (c.alpha !== undefined) mods.push(`<a:alpha val="${c.alpha}"/>`);
  const inner = mods.join('');
  if (c.kind === 'role') {
    const val = ROLE_TO_SCHEME[c.role];
    return inner ? `<a:schemeClr val="${val}">${inner}</a:schemeClr>` : `<a:schemeClr val="${val}"/>`;
  }
  const hex = escapeXmlAttr(c.value.replace(/^#/, '').toUpperCase());
  return inner ? `<a:srgbClr val="${hex}">${inner}</a:srgbClr>` : `<a:srgbClr val="${hex}"/>`;
}

export function solidFillXml(c: ThemeColor): string {
  return `<a:solidFill>${colorChildXml(c)}</a:solidFill>`;
}

/**
 * Serialize a linear {@link GradientFill} to `<a:gradFill>` — inverse of the
 * importer's `parseGradientFill`. Stop `pos` (0..1) → 1000ths-of-a-percent;
 * `angle` (radians) → `<a:lin ang>` in 60000ths-of-a-degree, normalized to
 * `[0, 360)`.
 */
export function gradFillXml(g: GradientFill): string {
  const stops = g.stops
    .map((s) => {
      const pos = Math.round(Math.max(0, Math.min(1, s.pos)) * 100_000);
      return `<a:gs pos="${pos}">${colorChildXml(s.color)}</a:gs>`;
    })
    .join('');
  const deg = (((g.angle * 180) / Math.PI) % 360 + 360) % 360;
  const ang = Math.round(deg * 60_000);
  return `<a:gradFill><a:gsLst>${stops}</a:gsLst><a:lin ang="${ang}" scaled="1"/></a:gradFill>`;
}

/**
 * Serialize any shape {@link Fill} — solid or gradient. A gradient with
 * fewer than two stops is not a valid `CT_GradientStopList` (`gs`
 * minOccurs=2 — PowerPoint rejects it), so it degrades to a solid fill of
 * its representative stop, matching how the canvas renderer paints it.
 */
export function fillXml(fill: Fill): string {
  if (fill.kind === 'gradient' && fill.stops.length >= 2) return gradFillXml(fill);
  return solidFillXml(representativeColor(fill));
}
