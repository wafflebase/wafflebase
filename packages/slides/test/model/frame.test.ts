import { describe, it, expect } from 'vitest';
import type { Frame } from '../../src/model/element';
import { containsPoint, boundingBox, combinedBoundingBox } from '../../src/model/frame';

const f = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({
  x, y, w, h, rotation,
});

describe('containsPoint', () => {
  it('returns true for a point inside an axis-aligned frame', () => {
    expect(containsPoint(f(10, 10, 100, 50), 50, 30)).toBe(true);
  });

  it('returns false for a point outside an axis-aligned frame', () => {
    expect(containsPoint(f(10, 10, 100, 50), 200, 200)).toBe(false);
  });

  it('returns true for a point on the edge', () => {
    expect(containsPoint(f(0, 0, 100, 100), 100, 100)).toBe(true);
    expect(containsPoint(f(0, 0, 100, 100), 0, 0)).toBe(true);
  });
});

const TAU = Math.PI * 2;

describe('containsPoint with rotation', () => {
  it('includes a point that lands inside after rotation', () => {
    // 100×40 frame at origin, rotated 90° around its center.
    const frame = f(0, 0, 100, 40, Math.PI / 2);
    // Center of the frame is unchanged.
    expect(containsPoint(frame, 50, 20)).toBe(true);
    // A point well outside the un-rotated bbox but inside the rotated one:
    // the rotated frame extends roughly from x=30..70, y=-30..70.
    expect(containsPoint(frame, 50, -10)).toBe(true);
    // A point that the un-rotated bbox would include but the rotation excludes.
    expect(containsPoint(frame, 95, 20)).toBe(false);
  });

  it('round-trip: rotate by 2π is identity for hit-test', () => {
    const base = f(10, 10, 80, 60, 0);
    const rotated = f(10, 10, 80, 60, TAU);
    for (const [px, py] of [[50, 40], [9, 9], [95, 75]]) {
      expect(containsPoint(rotated, px, py)).toBe(containsPoint(base, px, py));
    }
  });
});

describe('boundingBox', () => {
  it('returns the frame itself when not rotated', () => {
    expect(boundingBox(f(10, 20, 100, 50))).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('grows for rotated frames', () => {
    // 100×40 at 45°: bbox dims = (100 + 40)·√2/2 ≈ 99 on each axis.
    // The width SHRINKS from 100 → ~99 because the long edge now lies
    // on the diagonal; the height grows from 40 → ~99.
    const box = boundingBox(f(0, 0, 100, 40, Math.PI / 4));
    expect(box.h).toBeGreaterThan(40);

    // For a square-ish frame, the bbox grows on BOTH axes.
    const sqBox = boundingBox(f(0, 0, 60, 60, Math.PI / 4));
    expect(sqBox.w).toBeGreaterThan(60);
    expect(sqBox.h).toBeGreaterThan(60);
  });
});

describe('combinedBoundingBox', () => {
  it('returns undefined for an empty list', () => {
    expect(combinedBoundingBox([])).toBeUndefined();
  });

  it('encloses two non-overlapping frames', () => {
    const box = combinedBoundingBox([f(0, 0, 100, 100), f(200, 50, 50, 50)]);
    expect(box).toEqual({ x: 0, y: 0, w: 250, h: 100 });
  });
});
