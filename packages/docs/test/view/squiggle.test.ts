import { describe, it, expect } from 'vitest';
import { squigglePoints } from '../../src/view/doc-canvas.js';

describe('squigglePoints', () => {
  it('alternates above and on the baseline', () => {
    const pts = squigglePoints(0, 4, 10, 2, 2);
    expect(pts[0]).toEqual([0, 10]);
    expect(pts[1]).toEqual([0, 8]);  // up
    expect(pts[2]).toEqual([2, 10]); // down
    expect(pts[3]).toEqual([4, 8]);  // up
  });

  it('starts at the given x position', () => {
    const pts = squigglePoints(10, 4, 20, 1.5, 2);
    expect(pts[0]).toEqual([10, 20]);
  });

  it('uses default amp and step when omitted', () => {
    const pts = squigglePoints(0, 2, 10);
    // First point is always at baseline
    expect(pts[0]).toEqual([0, 10]);
    // Second point should be 1.5 above baseline (default amp)
    expect(pts[1]).toEqual([0, 8.5]);
  });
});
