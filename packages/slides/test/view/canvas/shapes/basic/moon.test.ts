import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMoon, MOON_ADJUSTMENTS, MOON_HANDLES } from '../../../../../src/view/canvas/shapes/basic/moon';

describe('buildMoon', () => {
  it('fills the crescent on the left side', () => {
    const path = buildMoon({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true);
  });

  it('default thickness is 50000', () => {
    expect(MOON_ADJUSTMENTS[0].defaultValue).toBe(50000);
  });
});

describe('MOON_HANDLES', () => {
  it('exposes one handle', () => {
    expect(MOON_HANDLES.length).toBe(1);
  });
});
