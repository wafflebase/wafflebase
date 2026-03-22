export type RulerUnit = 'inch' | 'cm';

export interface GridConfig {
  majorStepPx: number;
  subdivisions: number;
  minorStepPx: number;
}

const INCH_LOCALES = ['en-US', 'en-GB', 'my'];

export function detectUnit(locale: string | undefined): RulerUnit {
  if (!locale) return 'inch';
  if (INCH_LOCALES.some((l) => locale.startsWith(l.split('-')[0]) && locale === l)) {
    return 'inch';
  }
  if (locale.startsWith('en')) return 'inch';
  return 'cm';
}

export function getGridConfig(unit: RulerUnit): GridConfig {
  if (unit === 'inch') {
    return { majorStepPx: 96, subdivisions: 8, minorStepPx: 12 };
  }
  const cmPx = 96 / 2.54;
  return { majorStepPx: cmPx, subdivisions: 10, minorStepPx: cmPx / 10 };
}

export function snapToGrid(px: number, step: number): number {
  return Math.round(px / step) * step;
}
