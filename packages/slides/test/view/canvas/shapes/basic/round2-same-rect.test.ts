import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildRound2SameRect,
  ROUND2_SAME_RECT_ADJUSTMENTS,
  ROUND2_SAME_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/round2-same-rect';

describe('buildRound2SameRect', () => {
  it('OOXML default (adj1=16667, adj2=0) rounds only the TOP corners', () => {
    expect(ROUND2_SAME_RECT_ADJUSTMENTS[0].defaultValue).toBe(16667);
    expect(ROUND2_SAME_RECT_ADJUSTMENTS[1].defaultValue).toBe(0);
    const path = buildRound2SameRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false); // NW outside arc
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false); // NE outside arc
    expect(ctx.isPointInPath(path, 1, 99)).toBe(true); // SW square
    expect(ctx.isPointInPath(path, 99, 99)).toBe(true); // SE square
  });

  it('adj2 rounds the BOTTOM corners', () => {
    const path = buildRound2SameRect({ w: 100, h: 100 }, [0, 16667]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 1, 1)).toBe(true); // NW square
    expect(ctx.isPointInPath(path, 99, 1)).toBe(true); // NE square
    expect(ctx.isPointInPath(path, 1, 99)).toBe(false); // SW outside arc
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false); // SE outside arc
  });
});

describe('ROUND2_SAME_RECT_HANDLES', () => {
  it('a top-edge handle (adj1) and a bottom-edge handle (adj2)', () => {
    expect(ROUND2_SAME_RECT_HANDLES.length).toBe(2);
    const top = ROUND2_SAME_RECT_HANDLES[0].position({ w: 100, h: 100 }, [16667, 16667]);
    const bot = ROUND2_SAME_RECT_HANDLES[1].position({ w: 100, h: 100 }, [16667, 16667]);
    expect(top.y).toBe(0);
    expect(bot.y).toBe(100);
  });
});
