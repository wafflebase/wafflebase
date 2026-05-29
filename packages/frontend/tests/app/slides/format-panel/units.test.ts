import { describe, it, expect } from 'vitest';
import {
  PX_PER_IN,
  PX_PER_CM,
  pxToUnit,
  unitToPx,
  formatDisplay,
  radToDeg,
  degToRad,
  getCommonValue,
} from '@/app/slides/format-panel/units';

describe('px↔unit conversion', () => {
  it('PX_PER_IN matches the 1920px / 10in canvas ratio', () => {
    expect(PX_PER_IN).toBe(192);
  });

  it('PX_PER_CM = PX_PER_IN / 2.54', () => {
    expect(PX_PER_CM).toBeCloseTo(192 / 2.54, 10);
  });

  it('pxToUnit("in") converts canvas px to inches', () => {
    expect(pxToUnit(192, 'in')).toBeCloseTo(1, 10);
    expect(pxToUnit(1920, 'in')).toBeCloseTo(10, 10);
  });

  it('pxToUnit("cm") converts canvas px to centimeters', () => {
    expect(pxToUnit(PX_PER_CM, 'cm')).toBeCloseTo(1, 10);
  });

  it('unitToPx is the inverse of pxToUnit', () => {
    for (const u of ['in', 'cm'] as const) {
      for (const v of [0, 0.5, 1, 3.75, 10]) {
        expect(unitToPx(pxToUnit(unitToPx(v, u), u), u)).toBeCloseTo(
          unitToPx(v, u),
          10,
        );
      }
    }
  });

  it('formatDisplay rounds to 2 decimal places', () => {
    expect(formatDisplay(192, 'in')).toBe('1.00');
    expect(formatDisplay(96, 'in')).toBe('0.50');
    expect(formatDisplay(193, 'in')).toBe('1.01');
  });
});

describe('rad↔deg', () => {
  it('radToDeg', () => {
    expect(radToDeg(0)).toBe(0);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 10);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 10);
  });

  it('degToRad', () => {
    expect(degToRad(0)).toBe(0);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 10);
    expect(degToRad(360)).toBeCloseTo(Math.PI * 2, 10);
  });
});

describe('getCommonValue', () => {
  it('returns the value when every element matches', () => {
    const arr = [{ x: 10 }, { x: 10 }, { x: 10 }];
    expect(getCommonValue(arr, (e) => e.x)).toBe(10);
  });

  it('returns undefined when any element differs', () => {
    const arr = [{ x: 10 }, { x: 20 }];
    expect(getCommonValue(arr, (e) => e.x)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(getCommonValue([], (e: { x: number }) => e.x)).toBeUndefined();
  });

  it('supports a custom equality fn (e.g. tolerance)', () => {
    const arr = [{ x: 1.0001 }, { x: 1.0002 }];
    const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;
    expect(getCommonValue(arr, (e) => e.x, eq)).toBeCloseTo(1.0001, 5);
  });
});
