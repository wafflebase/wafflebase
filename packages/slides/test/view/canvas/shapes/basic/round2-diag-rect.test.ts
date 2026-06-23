import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildRound2DiagRect,
  ROUND2_DIAG_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/round2-diag-rect';

describe('buildRound2DiagRect', () => {
  it('rounds NW + SE by default; NE + SW stay sharp (OOXML)', () => {
    const path = buildRound2DiagRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // NE + SW are square by default (adj2 = 0) → filled to the corner.
    expect(ctx.isPointInPath(path, 98, 2)).toBe(true);
    expect(ctx.isPointInPath(path, 2, 98)).toBe(true);
    // NW + SE rounded (adj1 = 16667) → corners excluded.
    expect(ctx.isPointInPath(path, 2, 2)).toBe(false);
    expect(ctx.isPointInPath(path, 98, 98)).toBe(false);
  });
});

describe('ROUND2_DIAG_RECT_HANDLES', () => {
  it('top + left handles', () => {
    expect(ROUND2_DIAG_RECT_HANDLES.length).toBe(2);
  });
});
