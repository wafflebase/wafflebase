import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildUpDownArrow,
  UP_DOWN_ARROW_ADJUSTMENTS,
  UP_DOWN_ARROW_HANDLES,
} from './up-down-arrow';

describe('buildUpDownArrow', () => {
  it('fills the shaft and both heads', () => {
    const path = buildUpDownArrow({ w: 100, h: 200 });
    const ctx = createTestCanvas(200, 400).getContext('2d');
    // Middle of the shaft.
    expect(ctx.isPointInPath(path, 50, 100)).toBe(true);
    // Top tip area.
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    // Outside the shape.
    expect(ctx.isPointInPath(path, 5, 100)).toBe(false);
  });

  it('default adjustments are 50000 / 50000', () => {
    expect(UP_DOWN_ARROW_ADJUSTMENTS[0].defaultValue).toBe(50000);
    expect(UP_DOWN_ARROW_ADJUSTMENTS[1].defaultValue).toBe(50000);
  });
});

describe('UP_DOWN_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(UP_DOWN_ARROW_HANDLES.length).toBe(2);
  });
});
