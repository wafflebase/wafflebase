import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildRoundRect } from './round-rect';

describe('buildRoundRect', () => {
  it('produces a rounded rectangle with quadratic corners', () => {
    const path = buildRoundRect({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // centre
    expect(ctx.isPointInPath(path, 10, 10)).toBe(true); // just past corner curve
    expect(ctx.isPointInPath(path, 90, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 0, 0)).toBe(false); // corner cut by curve
    expect(ctx.isPointInPath(path, 100, 60)).toBe(false); // far corner cut
  });
});
