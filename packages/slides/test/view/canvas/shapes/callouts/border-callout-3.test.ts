import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout3,
  BORDER_CALLOUT_3_ADJUSTMENTS,
  BORDER_CALLOUT_3_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-3';

describe('buildBorderCallout3', () => {
  it('produces a Path2D', () => {
    expect(buildBorderCallout3({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
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
