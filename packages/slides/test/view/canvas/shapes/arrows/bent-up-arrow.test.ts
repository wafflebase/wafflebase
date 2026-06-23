import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBentUpArrow,
  BENT_UP_ARROW_ADJUSTMENTS,
  BENT_UP_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/bent-up-arrow';

describe('buildBentUpArrow', () => {
  it('fills the bottom arm + vertical right arm with the head pointing up', () => {
    const path = buildBentUpArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Bottom-left of horizontal arm.
    expect(ctx.isPointInPath(path, 30, 185)).toBe(true);
    // Arrowhead tip is at the top of the vertical right arm.
    // ss=200, dx3=200*25000/100000=50 -> tip x = 150, near the top.
    expect(ctx.isPointInPath(path, 150, 5)).toBe(true);
    // Upper-left, away from the arm, stays empty.
    expect(ctx.isPointInPath(path, 20, 20)).toBe(false);
  });

  it('has three independent OOXML adjustments', () => {
    expect(BENT_UP_ARROW_ADJUSTMENTS.length).toBe(3);
    expect(BENT_UP_ARROW_ADJUSTMENTS[0].name).toMatch(/shaft/i);
    expect(BENT_UP_ARROW_ADJUSTMENTS[1].name).toMatch(/width/i);
    expect(BENT_UP_ARROW_ADJUSTMENTS[2].name).toMatch(/length/i);
    expect(BENT_UP_ARROW_ADJUSTMENTS.every((a) => a.defaultValue === 25000)).toBe(
      true,
    );
  });

  it('head width is independent of shaft thickness', () => {
    // Widening the head (adj2) without changing the shaft (adj1) must
    // grow the arrowhead base beyond the shaft-coupled 0.75 ratio.
    const narrow = buildBentUpArrow({ w: 200, h: 200 }, [25000, 10000, 25000]);
    const wide = buildBentUpArrow({ w: 200, h: 200 }, [25000, 50000, 25000]);
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // ss=200, head row y in [0..y1=50]. Near the base (y=45):
    //   wide  head spans x in [~10 .. ~190] (left base x1=0, tip x3=100)
    //   narrow head spans x in [~162 .. ~198] (left base x1=160, tip x3=180)
    // so x=120 sits inside the wide head only.
    expect(ctx.isPointInPath(wide, 120, 45)).toBe(true);
    expect(ctx.isPointInPath(narrow, 120, 45)).toBe(false);
  });
});

describe('BENT_UP_ARROW_HANDLES', () => {
  it('exposes three handles (shaft, head width, head length)', () => {
    expect(BENT_UP_ARROW_HANDLES.length).toBe(3);
  });
});
