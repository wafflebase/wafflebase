import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout3,
  buildBorderCallout3Outline,
  BORDER_CALLOUT_3_ADJUSTMENTS,
  BORDER_CALLOUT_3_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-3';

describe('buildBorderCallout3', () => {
  it('fills the FULL frame body (incl. center, top and bottom edges)', () => {
    const path = buildBorderCallout3({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 100)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 10)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 190)).toBe(true);
  });

  it('outline contains the two-bend leader (anchor → bend1 → bend2 → target)', () => {
    const path = buildBorderCallout3Outline({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    // Interior anchor: (-8333%,18750%) → (-16.7, 37.5).
    expect(ctx.isPointInStroke(path, -16.7, 37.5)).toBe(true);
    // Bend1: (38000%,88000%) → (76, 176).
    expect(ctx.isPointInStroke(path, 76, 176)).toBe(true);
    // Bend2: (25000%,100000%) → (50, 200).
    expect(ctx.isPointInStroke(path, 50, 200)).toBe(true);
    // Target: (18750%,115000%) → (37.5, 230).
    expect(ctx.isPointInStroke(path, 37.5, 230)).toBe(true);
  });

  it('outline includes the rectangle border', () => {
    const path = buildBorderCallout3Outline({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    expect(ctx.isPointInStroke(path, 100, 0)).toBe(true);
  });

  it('has 6 adjustments', () => {
    expect(BORDER_CALLOUT_3_ADJUSTMENTS).toHaveLength(6);
  });
});

describe('BORDER_CALLOUT_3_HANDLES', () => {
  it('exposes three handles (2 bends + target)', () => {
    expect(BORDER_CALLOUT_3_HANDLES.length).toBe(3);
  });
});
