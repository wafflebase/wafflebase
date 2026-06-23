import type { ColorRole, ThemeColor } from '../../model/theme';
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
