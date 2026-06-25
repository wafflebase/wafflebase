import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildMathNotEqual,
  MATH_NOT_EQUAL_ADJUSTMENTS,
} from '../../../../../src/view/canvas/shapes/equation/math-not-equal';

/**
 * Horizontal span [minX, maxX] of the filled region at height `y`,
 * scanned across the element width. In the gap between the two bars
 * only the slash is filled, so this isolates the slash there.
 */
type Hit = { isPointInPath(path: Path2D, x: number, y: number): boolean };

function filledSpanAtY(
  ctx: Hit,
  path: Path2D,
  y: number,
  w: number,
): [number, number] | null {
  let min: number | null = null;
  let max = 0;
  for (let x = 0; x <= w; x += 0.25) {
    if (ctx.isPointInPath(path, x, y)) {
      if (min === null) min = x;
      max = x;
    }
  }
  return min === null ? null : [min, max];
}

describe('buildMathNotEqual', () => {
  const ctx = createTestCanvas(120, 120).getContext('2d')!;

  it('produces a `≠` glyph with two bars and a diagonal slash', () => {
    const path = buildMathNotEqual({ w: 60, h: 60 });
    expect(ctx.isPointInPath(path, 30, 20)).toBe(true); // inside top bar
    expect(ctx.isPointInPath(path, 30, 40)).toBe(true); // inside bottom bar
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // on the slash (center)
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // outside everything
  });

  it('defaults to the ECMA-376 adjustment values', () => {
    // [bar thickness, slash ANGLE (60000ths°), gap].
    expect(MATH_NOT_EQUAL_ADJUSTMENTS.map((a) => a.defaultValue)).toEqual([
      23520, 6600000, 11760,
    ]);
    // adj2 is an angle in the 70°..110° polar range, not a fraction.
    expect(MATH_NOT_EQUAL_ADJUSTMENTS[1].min).toBe(4200000);
    expect(MATH_NOT_EQUAL_ADJUSTMENTS[1].max).toBe(6600000);
  });

  it('draws the slash steeper than 45° (ECMA default ≈70° from horizontal)', () => {
    // For a square frame the gap sits roughly y∈[26.5, 33.5]; sample two
    // levels inside it and measure how far the slash centre shifts.
    const path = buildMathNotEqual({ w: 60, h: 60 });
    const top = filledSpanAtY(ctx, path, 28, 60);
    const bot = filledSpanAtY(ctx, path, 32, 60);
    expect(top).not.toBeNull();
    expect(bot).not.toBeNull();
    const cTop = (top![0] + top![1]) / 2;
    const cBot = (bot![0] + bot![1]) / 2;
    // Direction: the default "/" slash leans right going up, so the upper
    // sample's centre sits right of the lower one. Locks orientation so a
    // mirrored/sign-flipped slash (the prior reverted bug) is caught.
    expect(cTop).toBeGreaterThan(cBot);
    // dx/dy slope of the centreline. A 45° slash → |slope| ≈ 1; the
    // ECMA default (20° from vertical) → |slope| ≈ tan(20°) ≈ 0.36.
    const slope = Math.abs((cTop - cBot) / (32 - 28));
    expect(slope).toBeGreaterThan(0.2);
    expect(slope).toBeLessThan(0.6);
  });

  it('gives the slash the same weight as the bars (no separate thin stroke)', () => {
    const path = buildMathNotEqual({ w: 60, h: 60 });
    // Slash-only horizontal width at the vertical centre.
    const span = filledSpanAtY(ctx, path, 30, 60);
    expect(span).not.toBeNull();
    const width = span![1] - span![0];
    // bar thickness dy1 = 60*23520/100000 ≈ 14.1; the slash's horizontal
    // extent is dy1/cos(20°) ≈ 15.0 — far thicker than the old 6.6 model.
    expect(width).toBeGreaterThan(13);
    expect(width).toBeLessThan(17);
  });

  it('responds to the slash-angle adjustment (vertical slash has ~0 slope)', () => {
    // adj2 = 5400000 (90°) ⇒ vertical slash through the centre.
    const path = buildMathNotEqual({ w: 60, h: 60 }, [23520, 5400000, 11760]);
    const top = filledSpanAtY(ctx, path, 28, 60);
    const bot = filledSpanAtY(ctx, path, 32, 60);
    const cTop = (top![0] + top![1]) / 2;
    const cBot = (bot![0] + bot![1]) / 2;
    expect(Math.abs(cTop - cBot)).toBeLessThan(0.5);
  });

  it('returns an empty path for a degenerate (zero-size) frame', () => {
    // h=0 would divide by hd2/len → NaN vertices; the guard returns empty.
    const path = buildMathNotEqual({ w: 60, h: 0 });
    expect(ctx.isPointInPath(path, 30, 0)).toBe(false);
  });
});
