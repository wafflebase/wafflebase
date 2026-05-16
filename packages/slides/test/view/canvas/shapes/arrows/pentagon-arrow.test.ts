import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPentagonArrow } from '../../../../../src/view/canvas/shapes/arrows/pentagon-arrow';

describe('buildPentagonArrow', () => {
  it('produces a homePlate-style pentagon pointing right', () => {
    const path = buildPentagonArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false);
  });
});
