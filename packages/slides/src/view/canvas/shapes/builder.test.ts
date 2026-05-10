import { describe, it, expect } from 'vitest';
import { regularPolygonPath } from './builder';

describe('regularPolygonPath', () => {
  it('places the first vertex apex-up at default rotation', () => {
    const verts = regularPolygonPath(50, 50, 50, 50, 5);
    expect(verts).toHaveLength(5);
    expect(verts[0].x).toBeCloseTo(50, 5);
    expect(verts[0].y).toBeCloseTo(0, 5); // top of inscribing circle
  });

  it('returns equally spaced vertices on the inscribed ellipse', () => {
    const verts = regularPolygonPath(0, 0, 1, 1, 4);
    // square at default rotation: top, right, bottom, left
    expect(verts[0].x).toBeCloseTo(0, 5);
    expect(verts[0].y).toBeCloseTo(-1, 5);
    expect(verts[1].x).toBeCloseTo(1, 5);
    expect(verts[1].y).toBeCloseTo(0, 5);
    expect(verts[2].x).toBeCloseTo(0, 5);
    expect(verts[2].y).toBeCloseTo(1, 5);
    expect(verts[3].x).toBeCloseTo(-1, 5);
    expect(verts[3].y).toBeCloseTo(0, 5);
  });

  it('honours an explicit rotation override', () => {
    // 4-gon rotated +45° from default -π/2 is a "diamond" with vertices on the axes shifted
    const verts = regularPolygonPath(0, 0, 1, 1, 4, -Math.PI / 4);
    expect(verts[0].x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(verts[0].y).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('supports an elliptical inscribed shape (rx ≠ ry)', () => {
    const verts = regularPolygonPath(0, 0, 4, 2, 4);
    // top-of-ellipse vertex at (0, -2), right at (4, 0)
    expect(verts[0].x).toBeCloseTo(0, 5);
    expect(verts[0].y).toBeCloseTo(-2, 5);
    expect(verts[1].x).toBeCloseTo(4, 5);
    expect(verts[1].y).toBeCloseTo(0, 5);
  });
});
