import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildRound1Rect, ROUND1_RECT_HANDLES } from '../../../../../src/view/canvas/shapes/basic/round1-rect';

describe('buildRound1Rect', () => {
  it('fills centre and excludes the NE corner outside the round arc', () => {
    const path = buildRound1Rect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false);
  });
});

describe('ROUND1_RECT_HANDLES', () => {
  it('one top-edge handle', () => {
    expect(ROUND1_RECT_HANDLES.length).toBe(1);
  });
});
