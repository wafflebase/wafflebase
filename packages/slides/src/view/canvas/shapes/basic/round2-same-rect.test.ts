import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildRound2SameRect,
  ROUND2_SAME_RECT_HANDLES,
} from './round2-same-rect';

describe('buildRound2SameRect', () => {
  it('fills centre, excludes both top corners outside the arcs', () => {
    const path = buildRound2SameRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false);
  });
});

describe('ROUND2_SAME_RECT_HANDLES', () => {
  it('two top-edge handles', () => {
    expect(ROUND2_SAME_RECT_HANDLES.length).toBe(2);
  });
});
