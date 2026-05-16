// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDESCREEN_EMU,
  EMU_PER_INCH,
  emuScale,
  parseXfrm,
  prstToShapeKind,
  rotEmuToRad,
} from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';

describe('emuScale', () => {
  it('scales widescreen to 1920×1080 exactly', () => {
    const s = emuScale(DEFAULT_WIDESCREEN_EMU);
    expect(s.sx).toBeCloseTo(1920 / DEFAULT_WIDESCREEN_EMU.cx, 12);
    expect(s.sy).toBeCloseTo(1080 / DEFAULT_WIDESCREEN_EMU.cy, 12);
    // Sanity: widescreen aspect ratio matches our canvas.
    expect(s.sx).toBeCloseTo(s.sy, 12);
  });

  it('scales 10″×5.625″ standard 16:9 (Yorkie 캐즘 deck) without distortion', () => {
    const s = emuScale({ cx: 9_144_000, cy: 5_143_500 });
    // Both axes share the same scale → no aspect distortion.
    expect(s.sx).toBeCloseTo(s.sy, 6);
    // Logical canvas width should land exactly at 1920 px.
    expect(9_144_000 * s.sx).toBeCloseTo(1920, 6);
    expect(5_143_500 * s.sy).toBeCloseTo(1080, 6);
  });

  it('falls back to widescreen defaults for invalid dimensions', () => {
    const widescreen = emuScale(DEFAULT_WIDESCREEN_EMU);
    expect(emuScale({ cx: 0, cy: 0 })).toEqual(widescreen);
    expect(emuScale({ cx: -1, cy: 100 })).toEqual({ sx: widescreen.sx, sy: 1080 / 100 });
    expect(emuScale({ cx: Number.NaN, cy: Number.NaN })).toEqual(widescreen);
    expect(emuScale({ cx: Number.POSITIVE_INFINITY, cy: 100 })).toEqual({
      sx: widescreen.sx,
      sy: 1080 / 100,
    });
  });
});

describe('rotEmuToRad', () => {
  it('converts OOXML 60000ths-of-degree to radians', () => {
    expect(rotEmuToRad(0)).toBe(0);
    expect(rotEmuToRad(5_400_000)).toBeCloseTo(Math.PI / 2, 9); // 90°
    expect(rotEmuToRad(-5_400_000)).toBeCloseTo(-Math.PI / 2, 9);
    expect(rotEmuToRad(10_800_000)).toBeCloseTo(Math.PI, 9); // 180°
  });
});

describe('parseXfrm', () => {
  it('reads off/ext/rot through the scale', () => {
    const xml = `<a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" rot="5400000"><a:off x="914400" y="457200"/><a:ext cx="1828800" cy="914400"/></a:xfrm>`;
    const xfrm = parseXml(xml).documentElement;
    const s = emuScale(DEFAULT_WIDESCREEN_EMU);
    const frame = parseXfrm(xfrm, s);
    expect(frame.x).toBeCloseTo(914_400 * s.sx, 6);
    expect(frame.y).toBeCloseTo(457_200 * s.sy, 6);
    expect(frame.w).toBeCloseTo(1_828_800 * s.sx, 6);
    expect(frame.h).toBeCloseTo(914_400 * s.sy, 6);
    expect(frame.rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it('returns the zero frame when xfrm is missing', () => {
    expect(parseXfrm(undefined, emuScale(DEFAULT_WIDESCREEN_EMU))).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      rotation: 0,
    });
  });

  it('reads flipH / flipV when set, omits the fields when absent', () => {
    const s = emuScale(DEFAULT_WIDESCREEN_EMU);
    const noFlip = parseXfrm(
      parseXml(
        `<a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm>`,
      ).documentElement,
      s,
    );
    expect('flipH' in noFlip).toBe(false);
    expect('flipV' in noFlip).toBe(false);

    // Mirrors slide 6 of "Yorkie, 캐즘 뛰어넘기.pptx".
    const both = parseXfrm(
      parseXml(
        `<a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" flipH="1" rot="10800000"><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm>`,
      ).documentElement,
      s,
    );
    expect(both.flipH).toBe(true);
    expect('flipV' in both).toBe(false);
    expect(both.rotation).toBeCloseTo(Math.PI, 9);

    const flipV = parseXfrm(
      parseXml(
        `<a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" flipV="1"><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm>`,
      ).documentElement,
      s,
    );
    expect('flipH' in flipV).toBe(false);
    expect(flipV.flipV).toBe(true);
  });
});

describe('prstToShapeKind', () => {
  it('passes through registered shape kinds', () => {
    for (const prst of [
      'rect',
      'roundRect',
      'ellipse',
      'rtTriangle',
      'chevron',
      'blockArc',
      'uturnArrow',
      'flowChartOffpageConnector',
      'donut',
      'can',
    ]) {
      expect(prstToShapeKind(prst)).toBe(prst);
    }
  });

  it('returns undefined for unknown / unmapped names', () => {
    // Yorkie 캐즘 deck has 3 of these — caller falls back to rect.
    expect(prstToShapeKind('rightArrowCallout')).toBeUndefined();
    expect(prstToShapeKind('leftBracket')).toBeUndefined();
    expect(prstToShapeKind('homePlate')).toBeUndefined();
    expect(prstToShapeKind('totallyMadeUp')).toBeUndefined();
  });
});

describe('constants', () => {
  it('exposes the EMU-per-inch invariant', () => {
    expect(EMU_PER_INCH).toBe(914_400);
  });
});
