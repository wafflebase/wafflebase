import { toRgbHexColor } from '@wafflebase/docs';
import type { Theme } from '../../model/theme.js';
import { escapeXmlAttr } from './xml.js';

/**
 * The 12 OOXML `<a:clrScheme>` slot names in order, paired with the
 * `ColorScheme` key that holds the absolute hex value for each slot.
 *
 * These are ABSOLUTE colors, not role references — emitting
 * `<a:schemeClr>` here would be circular (the scheme IS the definition).
 * The importer in `import/pptx/theme.ts` reads these exact slot names
 * and stores the resolved hex under the paired `ColorScheme` key, so
 * writing srgb hex round-trips correctly.
 */
const CLR_SLOTS: Array<[string, keyof Theme['colors']]> = [
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

/**
 * Minimal `<a:fmtScheme>` boilerplate required by PowerPoint.
 * PowerPoint validates the presence of fillStyleLst (3 fills),
 * lnStyleLst (3 lines), effectStyleLst (3 effects), and bgFillStyleLst
 * (3 fills). Values use `phClr` placeholders — sufficient for our
 * round-trip use case.
 */
const FMT_SCHEME =
  '<a:fmtScheme name="Office">' +
  '<a:fillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '</a:fillStyleLst>' +
  '<a:lnStyleLst>' +
  '<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '</a:lnStyleLst>' +
  '<a:effectStyleLst>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle>' +
  '</a:effectStyleLst>' +
  '<a:bgFillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '</a:bgFillStyleLst>' +
  '</a:fmtScheme>';

/**
 * Normalize a stored theme color to the 6-digit uppercase form OOXML expects
 * for `<a:srgbClr val>` (`ST_HexColorRGB`).
 *
 * `Theme.colors[role]` is typed as a string but holds whatever JSON was
 * persisted — the content PUT API lets an authenticated caller store an
 * arbitrary string there — so stripping `#` and upper-casing is not enough:
 * the value could close the attribute and inject its own DrawingML into any
 * `.pptx` a victim later exports. Route it through the same
 * {@link toRgbHexColor} normalizer every other OOXML color sink uses
 * (`export/pptx/color.ts`, docs' `w:color`/`w:shd`), which provably returns
 * only `/^[0-9A-F]{6}$/` or `undefined`. A value it cannot express degrades to
 * black — matching `colorChildXml`'s backstop — because a `<a:clrScheme>` slot
 * is mandatory and cannot simply be dropped.
 */
function toSrgbHex(hex: string): string {
  return toRgbHexColor(hex) ?? '000000';
}

/**
 * Serialize a `Theme` to `ppt/theme/themeN.xml` content.
 *
 * clrScheme: emits `<a:srgbClr val="RRGGBB"/>` for every slot — the stored
 * hex values are absolute colors, not role references. Using `<a:schemeClr>`
 * here would be circular (the scheme IS the source of truth).
 *
 * fontScheme: maps `fonts.heading` → `<a:majorFont>` and `fonts.body` →
 * `<a:minorFont>`, matching the inverse of `import/pptx/theme.ts`
 * `parseFontScheme` (majorFont → heading, minorFont → body).
 */
export function themeToXml(theme: Theme, index: number): string {
  const schemeName = escapeXmlAttr(theme.name ?? `Theme${index}`);

  const colorSlots = CLR_SLOTS.map(([slot, role]) => {
    // `toSrgbHex` returns only `[0-9A-F]{6}`, so the value is injection-free by
    // construction rather than by escaping.
    const hex = toSrgbHex(theme.colors[role]);
    return `<a:${slot}><a:srgbClr val="${hex}"/></a:${slot}>`;
  }).join('');

  const clrScheme = `<a:clrScheme name="${schemeName}">${colorSlots}</a:clrScheme>`;

  const majorTypeface = escapeXmlAttr(theme.fonts.heading);
  const minorTypeface = escapeXmlAttr(theme.fonts.body);
  const fontScheme =
    `<a:fontScheme name="${schemeName}">` +
    `<a:majorFont><a:latin typeface="${majorTypeface}"/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${minorTypeface}"/></a:minorFont>` +
    `</a:fontScheme>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${schemeName}">` +
    `<a:themeElements>${clrScheme}${fontScheme}${FMT_SCHEME}</a:themeElements>` +
    `</a:theme>`
  );
}
