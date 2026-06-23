import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout1,
  buildBorderCallout1Outline,
  BORDER_CALLOUT_1_ADJUSTMENTS,
  BORDER_CALLOUT_1_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-1';

describe('buildBorderCallout1', () => {
  it('fills the FULL frame body (incl. center, top and bottom edges)', () => {
    const path = buildBorderCallout1({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Center and near both vertical edges — a full-frame rect fills all
    // of these. The old shrunk (75%) rect would FAIL near the bottom.
    expect(ctx.isPointInPath(path, 100, 100)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 10)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 190)).toBe(true);
  });

  it('body does NOT include the leader line outside the frame', () => {
    const path = buildBorderCallout1({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Default target y=112500% → y=225, below the 0..200 frame.
    expect(ctx.isPointInPath(path, 37.5, 225)).toBe(false);
  });

  it('outline contains the straight leader from anchor to target', () => {
    const path = buildBorderCallout1Outline({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    // Target endpoint: (18750%,112500%) → (37.5, 225).
    expect(ctx.isPointInStroke(path, 37.5, 225)).toBe(true);
    // Interior anchor: (-8333%,18750%) → (-16.7, 37.5).
    expect(ctx.isPointInStroke(path, -16.7, 37.5)).toBe(true);
    // A midpoint on the straight leader segment.
    expect(ctx.isPointInStroke(path, 10.4, 131.25)).toBe(true);
  });

  it('outline also includes the rectangle border', () => {
    const path = buildBorderCallout1Outline({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    expect(ctx.isPointInStroke(path, 100, 0)).toBe(true);
    expect(ctx.isPointInStroke(path, 0, 100)).toBe(true);
  });

  it('has 2 adjustments', () => {
    expect(BORDER_CALLOUT_1_ADJUSTMENTS).toHaveLength(2);
  });
});

describe('BORDER_CALLOUT_1_HANDLES', () => {
  it('exposes one target handle', () => {
    expect(BORDER_CALLOUT_1_HANDLES.length).toBe(1);
  });
});
