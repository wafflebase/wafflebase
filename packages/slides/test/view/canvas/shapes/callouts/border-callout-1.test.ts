import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout1,
  BORDER_CALLOUT_1_ADJUSTMENTS,
  BORDER_CALLOUT_1_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-1';

describe('buildBorderCallout1', () => {
  it('fills the rect body', () => {
    const path = buildBorderCallout1({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true);
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
