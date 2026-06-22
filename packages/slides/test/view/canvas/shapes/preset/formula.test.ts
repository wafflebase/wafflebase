import { describe, it, expect } from 'vitest';
import {
  evalFormula,
  evalGuides,
  ooxmlAngleToRad,
  OOXML_CIRCLE,
} from '../../../../../src/view/canvas/shapes/preset/formula';
import type { PresetShapeDef } from '../../../../../src/view/canvas/shapes/preset/types';

// Literal-only resolver (the formula's own operands are numeric).
const lit = (t: string) => Number(t);

describe('evalFormula', () => {
  it('evaluates the core arithmetic operators', () => {
    expect(evalFormula('val 25000', lit)).toBe(25000);
    expect(evalFormula('*/ 2 3 4', lit)).toBeCloseTo(1.5);
    expect(evalFormula('+- 5 2 3', lit)).toBe(4);
    expect(evalFormula('+/ 4 6 2', lit)).toBe(5);
    expect(evalFormula('abs -5', lit)).toBe(5);
    expect(evalFormula('sqrt 9', lit)).toBe(3);
    expect(evalFormula('min 2 5', lit)).toBe(2);
    expect(evalFormula('max 2 5', lit)).toBe(5);
  });

  it('clamps with pin and branches with ?:', () => {
    expect(evalFormula('pin 0 5 3', lit)).toBe(3); // above hi
    expect(evalFormula('pin 0 -1 3', lit)).toBe(0); // below lo
    expect(evalFormula('pin 0 2 3', lit)).toBe(2); // in range
    expect(evalFormula('?: 1 7 9', lit)).toBe(7); // x>0
    expect(evalFormula('?: 0 7 9', lit)).toBe(9); // x<=0
    expect(evalFormula('?: -1 7 9', lit)).toBe(9);
  });

  it('mod is 3-D vector magnitude', () => {
    expect(evalFormula('mod 3 4 0', lit)).toBe(5);
    expect(evalFormula('mod 1 2 2', lit)).toBe(3);
  });

  it('trig operators use 60000ths-of-a-degree angles', () => {
    const cd4 = OOXML_CIRCLE / 4; // 90°
    expect(evalFormula(`sin 100 ${cd4}`, lit)).toBeCloseTo(100);
    expect(evalFormula(`cos 100 ${cd4}`, lit)).toBeCloseTo(0);
    expect(evalFormula(`tan 100 ${OOXML_CIRCLE / 8}`, lit)).toBeCloseTo(100);
  });

  it('at2 returns the vector angle in 60000ths of a degree', () => {
    // atan2(1, 0) = 90°.
    expect(evalFormula('at2 0 1', lit)).toBeCloseTo(OOXML_CIRCLE / 4);
    // atan2(0, 1) = 0°.
    expect(evalFormula('at2 1 0', lit)).toBeCloseTo(0);
  });

  it('cat2/sat2 project an ellipse-parameter angle', () => {
    // For a circle (rw3 == rh3), cat2/sat2 reduce to plain cos/sin·r.
    // wt = sin r ang, ht = cos r ang ⇒ cat2 r ht wt = r·cos(ang).
    const ang = OOXML_CIRCLE / 6; // 60°
    const r = 50;
    const wt = r * Math.sin(ooxmlAngleToRad(ang));
    const ht = r * Math.cos(ooxmlAngleToRad(ang));
    expect(evalFormula(`cat2 ${r} ${ht} ${wt}`, lit)).toBeCloseTo(
      r * Math.cos(ooxmlAngleToRad(ang)),
    );
    expect(evalFormula(`sat2 ${r} ${ht} ${wt}`, lit)).toBeCloseTo(
      r * Math.sin(ooxmlAngleToRad(ang)),
    );
  });

  it('throws on an unknown operator', () => {
    expect(() => evalFormula('zzz 1 2', lit)).toThrow(/unknown operator/);
  });
});

describe('evalGuides', () => {
  const def: PresetShapeDef = {
    adj: { adj1: 25000, adj2: 50000 },
    guides: [
      { name: 'th', fmla: '*/ ss adj1 100000' },
      { name: 'half', fmla: 'val wd2' },
      { name: 'quarterTurn', fmla: 'val cd4' },
      { name: 'threeQ', fmla: 'val 3cd4' },
    ],
    paths: [],
  };

  it('resolves built-in dimensions and angle constants', () => {
    const r = evalGuides({ w: 200, h: 100 }, def);
    expect(r('w')).toBe(200);
    expect(r('h')).toBe(100);
    expect(r('ss')).toBe(100); // min(w,h)
    expect(r('ls')).toBe(200); // max(w,h)
    expect(r('hc')).toBe(100);
    expect(r('vc')).toBe(50);
    expect(r('wd2')).toBe(100);
    expect(r('hd6')).toBeCloseTo(100 / 6);
    expect(r('ssd8')).toBeCloseTo(100 / 8);
    expect(r('cd4')).toBe(OOXML_CIRCLE / 4);
    expect(r('3cd4')).toBe((3 * OOXML_CIRCLE) / 4);
  });

  it('seeds adjustment defaults and computed guides', () => {
    const r = evalGuides({ w: 200, h: 100 }, def);
    expect(r('adj1')).toBe(25000);
    expect(r('th')).toBeCloseTo((100 * 25000) / 100000); // 25
    expect(r('half')).toBe(100);
    expect(r('quarterTurn')).toBe(OOXML_CIRCLE / 4);
    expect(r('threeQ')).toBe((3 * OOXML_CIRCLE) / 4);
  });

  it('lets the element adjustment array override avLst defaults by index', () => {
    const r = evalGuides({ w: 200, h: 100 }, def, [50000]);
    expect(r('adj1')).toBe(50000);
    expect(r('th')).toBeCloseTo((100 * 50000) / 100000); // 50
    expect(r('adj2')).toBe(50000); // untouched default
  });

  it('throws on an unresolved token', () => {
    const r = evalGuides({ w: 10, h: 10 }, def);
    expect(() => r('nope')).toThrow(/unresolved token/);
  });

  it('throws on built-in tokens with a zero divisor', () => {
    const r = evalGuides({ w: 200, h: 100 }, def);
    expect(() => r('wd0')).toThrow(/invalid built-in divisor/);
    expect(() => r('cd0')).toThrow(/invalid built-in divisor/);
  });
});
