import { describe, it, expect } from 'vitest';
import { constrainToSquare } from '../../../../src/view/editor/interactions/constraints';

describe('constrainToSquare', () => {
  const ORIGIN = { x: 0, y: 0 };

  it('forces 1:1 in NE quadrant when |dx| > |dy|', () => {
    // start (0,0), end (100, 30) — dx wins, dy snaps to +100.
    expect(constrainToSquare(ORIGIN, { x: 100, y: 30 })).toEqual({ x: 100, y: 100 });
  });

  it('forces 1:1 in NE quadrant when |dy| > |dx|', () => {
    expect(constrainToSquare(ORIGIN, { x: 30, y: 100 })).toEqual({ x: 100, y: 100 });
  });

  it('preserves sign in SE quadrant (dx +, dy +) when dx wins', () => {
    expect(constrainToSquare(ORIGIN, { x: 80, y: 20 })).toEqual({ x: 80, y: 80 });
  });

  it('preserves sign in SW quadrant (dx -, dy +)', () => {
    expect(constrainToSquare(ORIGIN, { x: -80, y: 20 })).toEqual({ x: -80, y: 80 });
  });

  it('preserves sign in NW quadrant (dx -, dy -) when |dy| wins', () => {
    expect(constrainToSquare(ORIGIN, { x: -30, y: -90 })).toEqual({ x: -90, y: -90 });
  });

  it('preserves sign in NE quadrant (dx +, dy -)', () => {
    expect(constrainToSquare(ORIGIN, { x: 50, y: -120 })).toEqual({ x: 120, y: -120 });
  });

  it('returns end unchanged when start === end', () => {
    expect(constrainToSquare({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });

  it('handles exact |dx| === |dy| tie deterministically (no NaN, valid square)', () => {
    const out = constrainToSquare(ORIGIN, { x: 50, y: 50 });
    expect(out).toEqual({ x: 50, y: 50 });
  });

  it('works with a non-origin start', () => {
    // start (10, 20), end (60, 25) — dx=+50, dy=+5, |dx| wins → dy snaps to +50.
    expect(constrainToSquare({ x: 10, y: 20 }, { x: 60, y: 25 })).toEqual({ x: 60, y: 70 });
  });
});
