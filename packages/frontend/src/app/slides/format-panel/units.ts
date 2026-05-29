/**
 * Slide canvas is 1920×1080 px. Google Slides 16:9 deck is 10in
 * wide, so 1920 / 10 = 192 px per inch. Lossless to two decimal
 * places of inches.
 */
export const PX_PER_IN = 192;
export const PX_PER_CM = PX_PER_IN / 2.54;

export type DisplayUnit = 'in' | 'cm';

export function pxToUnit(px: number, unit: DisplayUnit): number {
  return unit === 'in' ? px / PX_PER_IN : px / PX_PER_CM;
}

export function unitToPx(value: number, unit: DisplayUnit): number {
  return unit === 'in' ? value * PX_PER_IN : value * PX_PER_CM;
}

export function formatDisplay(px: number, unit: DisplayUnit): string {
  return pxToUnit(px, unit).toFixed(2);
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Return the value common to every element via `accessor`, or
 * `undefined` if any element differs (or the list is empty).
 * `equals` defaults to `Object.is`.
 */
export function getCommonValue<T, V>(
  elements: readonly T[],
  accessor: (el: T) => V,
  equals: (a: V, b: V) => boolean = (a, b) => Object.is(a, b),
): V | undefined {
  if (elements.length === 0) return undefined;
  const first = accessor(elements[0]);
  for (let i = 1; i < elements.length; i++) {
    if (!equals(first, accessor(elements[i]))) return undefined;
  }
  return first;
}
