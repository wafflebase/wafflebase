import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildUturnArrow, UTURN_ARROW_HANDLES } from './uturn-arrow';

describe('buildUturnArrow', () => {
  it('produces a fillable U-shape', () => {
    const path = buildUturnArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Inside the left arm (lower portion).
    expect(ctx.isPointInPath(path, 15, 180)).toBe(true);
  });
});

describe('UTURN_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(UTURN_ARROW_HANDLES.length).toBe(2);
  });
});
