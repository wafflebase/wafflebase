import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildDonut } from './donut';

describe('buildDonut', () => {
  it('produces concentric ellipses fillable as a ring with evenodd rule', () => {
    const path = buildDonut({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Outer ring point — inside the donut.
    expect(ctx.isPointInPath(path, 5, 30, 'evenodd')).toBe(true);
    // Centre — inside the hole, NOT filled.
    expect(ctx.isPointInPath(path, 50, 30, 'evenodd')).toBe(false);
    // Outside everything.
    expect(ctx.isPointInPath(path, -5, 30, 'evenodd')).toBe(false);
  });
});
