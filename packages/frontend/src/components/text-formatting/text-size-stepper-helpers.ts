/**
 * Pure helpers backing `TextSizeStepper`. Kept in their own module so
 * the React component file only exports the component itself (Vite's
 * Fast Refresh requires this), and so the stops list can be unit-tested
 * without pulling React into the test runner.
 */

export const SIZE_STOPS = [
  6, 7, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44,
  48, 54, 60, 66, 72, 80, 88, 96,
] as const;

const DEFAULT_SIZE = 11;

/**
 * Bump a font size to the next / previous entry in `SIZE_STOPS`.
 * Off-grid values snap to the nearest stop in the requested direction;
 * `undefined` is treated as the docs default of 11. Clamps at the
 * ends of the list.
 */
export function bumpSize(current: number | undefined, dir: 1 | -1): number {
  const cur = current ?? DEFAULT_SIZE;
  if (dir === 1) {
    const next = SIZE_STOPS.find((s) => s > cur);
    return next ?? cur;
  }
  const prev = [...SIZE_STOPS].reverse().find((s) => s < cur);
  return prev ?? cur;
}
