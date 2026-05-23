/**
 * Locale-aware unit detection and grid configuration for the
 * docs/slides rulers. Pure helpers — no DOM, no canvas.
 *
 * `getGridConfig` takes `pxPerInch` so callers can specify their own
 * physical scale: docs uses 96 (1 CSS px = 1/96 inch), slides uses
 * 144 (1920 px logical canvas / 13.333"). Defaults to 96 for
 * backwards compatibility with the existing docs caller.
 */

export type RulerUnit = 'inch' | 'cm';

export interface GridConfig {
  majorStepPx: number;
  subdivisions: number;
  minorStepPx: number;
}

const INCH_LOCALES = ['en-US', 'en-GB', 'my'];

export function detectUnit(locale: string | undefined): RulerUnit {
  if (!locale) return 'inch';
  if (INCH_LOCALES.includes(locale)) return 'inch';
  if (locale.startsWith('en')) return 'inch';
  return 'cm';
}

export function getGridConfig(unit: RulerUnit, pxPerInch = 96): GridConfig {
  if (unit === 'inch') {
    return {
      majorStepPx: pxPerInch,
      subdivisions: 8,
      minorStepPx: pxPerInch / 8,
    };
  }
  const cmPx = pxPerInch / 2.54;
  return {
    majorStepPx: cmPx,
    subdivisions: 10,
    minorStepPx: cmPx / 10,
  };
}

export function snapToGrid(px: number, step: number): number {
  return Math.round(px / step) * step;
}
