import { describe, it, expect } from 'vitest';
import { constrainToSquare, snapEndpointAngle } from '../../../../src/view/editor/interactions/constraints';

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

describe('snapEndpointAngle', () => {
  const ORIGIN = { x: 0, y: 0 };
  const STEP = Math.PI / 12; // 15°

  it('leaves a 0° endpoint unchanged (along +X)', () => {
    const out = snapEndpointAngle(ORIGIN, { x: 100, y: 0 });
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(0);
  });

  it('leaves a 90° endpoint unchanged (along +Y)', () => {
    const out = snapEndpointAngle(ORIGIN, { x: 0, y: 50 });
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(50);
  });

  it('snaps 30° vector (100, ~57.74) down to 30° exactly', () => {
    // tan(30°) = 0.577..., so (100, 57.74) is already 30°.
    const out = snapEndpointAngle(ORIGIN, { x: 100, y: 100 * Math.tan(STEP * 2) });
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP * 2);
  });

  it('preserves vector length when snapping', () => {
    // (100, 30) — length sqrt(10900) ≈ 104.40.
    const end = { x: 100, y: 30 };
    const out = snapEndpointAngle(ORIGIN, end);
    const inLen = Math.hypot(end.x, end.y);
    const outLen = Math.hypot(out.x, out.y);
    expect(outLen).toBeCloseTo(inLen);
  });

  it('rounds 7° to 0°', () => {
    const end = { x: Math.cos(7 * Math.PI / 180) * 50, y: Math.sin(7 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(0);
  });

  it('rounds 8° to 15°', () => {
    const end = { x: Math.cos(8 * Math.PI / 180) * 50, y: Math.sin(8 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP);
  });

  it('rounds 22° to 15° (under midpoint)', () => {
    const end = { x: Math.cos(22 * Math.PI / 180) * 50, y: Math.sin(22 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP);
  });

  it('rounds 23° to 30° (over midpoint)', () => {
    const end = { x: Math.cos(23 * Math.PI / 180) * 50, y: Math.sin(23 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP * 2);
  });

  it('works in the negative-X / negative-Y quadrant', () => {
    // 195° input → snaps to 195° (= -165° = 13 * 15°).
    const target = 195 * Math.PI / 180;
    const end = { x: Math.cos(target) * 60, y: Math.sin(target) * 60 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    // 195° is already a 15° multiple, so unchanged.
    expect(angle).toBeCloseTo(target - 2 * Math.PI); // atan2 returns in (-π, π].
  });

  it('returns end unchanged when start === end (zero-length)', () => {
    expect(snapEndpointAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('works with a non-origin start', () => {
    const out = snapEndpointAngle({ x: 100, y: 100 }, { x: 200, y: 200 });
    const dx = out.x - 100;
    const dy = out.y - 100;
    expect(Math.atan2(dy, dx)).toBeCloseTo(Math.PI / 4);
  });
});
