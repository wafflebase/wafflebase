import type { Effects } from '../../model/element.js';
import { pxToEmu } from './units.js';
import { colorChildXml, colorFromStringOrTheme } from './color.js';

/**
 * Serialize paint-time effects (drop shadow, reflection) to
 * `<a:effectLst>`. Returns an empty string when `e` is undefined
 * or both shadow and reflection are absent.
 */
export function effectsToXml(e: Effects | undefined): string {
  if (!e || (!e.shadow && !e.reflection)) return '';
  const parts: string[] = [];
  if (e.shadow) {
    const s = e.shadow;
    // Angle stored as radians → OOXML 60000ths of a degree.
    const dir = Math.round(((s.angle * (180 / Math.PI)) % 360 + 360) % 360 * 60_000);
    // Opacity stored as [0,1] → OOXML 100000ths.
    const alpha = Math.round(s.opacity * 100_000);
    const colorWithAlpha = { ...colorFromStringOrTheme(s.color), alpha };
    parts.push(
      `<a:outerShdw blurRad="${pxToEmu(s.blur)}" dist="${pxToEmu(s.distance)}" dir="${dir}">` +
        `${colorChildXml(colorWithAlpha)}</a:outerShdw>`,
    );
  }
  if (e.reflection) {
    const r = e.reflection;
    // `endPos` (thousandths-of-percent) maps to `Reflection.size` in the
    // importer (`parseReflection` reads `endPos`, not `endA`). Emitting
    // only `endA` caused the size to always round-trip as 1 (the absent-
    // `endPos` default). Fix: emit `endPos` so the size survives.
    parts.push(
      `<a:reflection blurRad="0" stA="${Math.round(r.opacity * 100_000)}" endA="0"` +
      ` endPos="${Math.round(r.size * 100_000)}" dist="${pxToEmu(r.distance)}"/>`,
    );
  }
  return `<a:effectLst>${parts.join('')}</a:effectLst>`;
}
