import type { ColorRole, ColorScheme, FontScheme, Theme } from '../../model/theme';
import { parseHexInContainer } from './color';
import { parsePrimaryTypeface } from './font';
import { attr, child, descendant, parseXml } from './xml';

/**
 * OOXML `<a:clrScheme>` slot name → our `ColorScheme` key. The 12 slots
 * are positional; we read them by element name to be order-agnostic.
 */
const SCHEME_SLOTS: Array<[string, ColorRole]> = [
  ['dk1', 'text'],
  ['lt1', 'background'],
  ['dk2', 'textSecondary'],
  ['lt2', 'backgroundAlt'],
  ['accent1', 'accent1'],
  ['accent2', 'accent2'],
  ['accent3', 'accent3'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
  ['hlink', 'hyperlink'],
  ['folHlink', 'visitedHyperlink'],
];

/** Fallback when a theme slot is missing — uses `default-light` values. */
const FALLBACK_COLORS: ColorScheme = {
  text: '#202124',
  background: '#FFFFFF',
  textSecondary: '#5F6368',
  backgroundAlt: '#F1F3F4',
  accent1: '#1A73E8',
  accent2: '#34A853',
  accent3: '#FBBC04',
  accent4: '#EA4335',
  accent5: '#673AB7',
  accent6: '#FF6D01',
  hyperlink: '#1A73E8',
  visitedHyperlink: '#7B1FA2',
};

const FALLBACK_FONTS: FontScheme = { heading: 'Inter', body: 'Inter' };

/**
 * Parse a `ppt/theme/themeN.xml` into a `Theme`.
 *
 * Slot resolution is lossy but predictable: when a slot is missing or
 * uses an unresolved `<a:schemeClr>` reference, we fall back to the
 * matching `default-light` value rather than failing the import.
 */
export function parseTheme(xml: string, id: string): Theme {
  const doc = parseXml(xml);
  const themeEl = descendant(doc, 'theme');
  const elements = themeEl ? child(themeEl, 'themeElements') : undefined;
  const clrScheme = elements ? child(elements, 'clrScheme') : undefined;
  const fontScheme = elements ? child(elements, 'fontScheme') : undefined;

  return {
    id,
    name: (themeEl && attr(themeEl, 'name')) || id,
    colors: clrScheme ? parseColorScheme(clrScheme) : { ...FALLBACK_COLORS },
    fonts: fontScheme ? parseFontScheme(fontScheme) : { ...FALLBACK_FONTS },
  };
}

function parseColorScheme(scheme: Element): ColorScheme {
  const out: ColorScheme = { ...FALLBACK_COLORS };
  for (const [ooxmlSlot, role] of SCHEME_SLOTS) {
    const slot = child(scheme, ooxmlSlot);
    if (!slot) continue;
    const hex = parseHexInContainer(slot);
    if (hex) out[role] = hex;
  }
  return out;
}

function parseFontScheme(scheme: Element): FontScheme {
  const major = child(scheme, 'majorFont');
  const minor = child(scheme, 'minorFont');
  return {
    heading: (major && parsePrimaryTypeface(major)) || FALLBACK_FONTS.heading,
    body: (minor && parsePrimaryTypeface(minor)) || FALLBACK_FONTS.body,
  };
}
