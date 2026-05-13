import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildNotchedRightArrow,
  NOTCHED_RIGHT_ARROW_ADJUSTMENTS,
} from './notched-right-arrow';

describe('buildNotchedRightArrow', () => {
  it('fills the shaft and excludes the notch', () => {
    const path = buildNotchedRightArrow({ w: 200, h: 100 });
    const ctx = createTestCanvas(400, 200).getContext('2d');
    // Centre of the shaft.
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true);
    // Right inside the notch (CW notch dips inward from x=0).
    expect(ctx.isPointInPath(path, 25, 50)).toBe(false);
  });

  it('reuses ARROW_ADJUSTMENTS defaults', () => {
    expect(NOTCHED_RIGHT_ARROW_ADJUSTMENTS[0].defaultValue).toBe(50000);
    expect(NOTCHED_RIGHT_ARROW_ADJUSTMENTS[1].defaultValue).toBe(50000);
  });
});
