import { describe, expect, it } from 'vitest';
import { routeStraight } from '../../../src/view/canvas/routing';

describe('routeStraight', () => {
  it('produces a 2-point segment from a to b', () => {
    const p = routeStraight({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(p.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
  });

  it('handles zero-length (coincident endpoints)', () => {
    const p = routeStraight({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(p.points).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
  });
});
