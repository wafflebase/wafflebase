import { toRgbHexColor } from '@wafflebase/docs';
import { representativeColor, type ColorRole, type Fill, type GradientFill, type ThemeColor } from '../../model/theme';

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

/**
 * The lookup form of {@link ROLE_TO_SCHEME}.
 *
 * `ThemeColor.role` is a closed 12-value union to TypeScript, but the model
 * holds whatever the importer or the content PUT API stored, so at runtime the
 * key is untrusted. A bare `ROLE_TO_SCHEME[role]` reaches the prototype chain
 * (`role: 'constructor'` stringifies the `Object` constructor straight into the
 * attribute) and yields `undefined` — i.e. `val="undefined"` — for anything
 * else. A `Map` has no prototype keys, which is what makes the emitted
 * `val` genuinely closed rather than closed-by-convention.
 */
const SCHEME_BY_ROLE = new Map<string, string>(Object.entries(ROLE_TO_SCHEME));

export function colorFromStringOrTheme(c: ThemeColor | string): ThemeColor {
  return typeof c === 'string' ? { kind: 'srgb', value: c } : c;
}

/**
 * A color modifier (`<a:lumMod>`, `<a:tint>`, `<a:alpha>`, …) carries
 * `ST_Percentage` — a number, never free text. The model holds whatever the
 * importer or the content PUT API stored, so coerce here rather than escape:
 * a non-numeric value has no valid rendering, and dropping the modifier
 * leaves the base color intact. This is what keeps the attributes in this
 * file injection-free now that the hex `val` is normalized instead of
 * escaped — every attribute this function emits is either `[0-9A-F]{6}`, a
 * value out of the closed {@link SCHEME_BY_ROLE} map, or a finite number.
 */
function modifierXml(tag: string, value: number | undefined): string {
  if (value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `<a:${tag} val="${n}"/>`;
}

export function colorChildXml(c: ThemeColor): string {
  const mods: string[] = [];
  if ('lumMod' in c) mods.push(modifierXml('lumMod', c.lumMod));
  if ('lumOff' in c) mods.push(modifierXml('lumOff', c.lumOff));
  if ('tint' in c) mods.push(modifierXml('tint', c.tint));
  if ('shade' in c) mods.push(modifierXml('shade', c.shade));
  mods.push(modifierXml('alpha', c.alpha));
  const inner = mods.join('');
  if (c.kind === 'role') {
    const val = SCHEME_BY_ROLE.get(c.role);
    // Unknown role → black, matching `storedColorToThemeColor` in `text.ts`,
    // rather than a schema-invalid `val="undefined"`.
    if (val === undefined) {
      return inner ? `<a:srgbClr val="000000">${inner}</a:srgbClr>` : `<a:srgbClr val="000000"/>`;
    }
    return inner ? `<a:schemeClr val="${val}">${inner}</a:schemeClr>` : `<a:schemeClr val="${val}"/>`;
  }
  // `<a:srgbClr val>` is `ST_HexColorRGB` — exactly six hex digits. The model
  // holds whatever string reached it (import, HTML paste's `rgb(255, 0, 0)`,
  // the legacy `''` reset of issue #728), so normalize through the shared
  // converter every OOXML color sink uses. Callers that can omit the color
  // (`text.ts`) already drop it before getting here; this is the backstop for
  // the sinks that must emit *some* color — shape/gradient/background fills —
  // where black matches the "unknown role" fallback below.
  const hex = toRgbHexColor(c.value) ?? '000000';
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
