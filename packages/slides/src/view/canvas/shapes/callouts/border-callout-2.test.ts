import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import {
  buildBorderCallout2,
  BORDER_CALLOUT_2_ADJUSTMENTS,
  BORDER_CALLOUT_2_HANDLES,
} from './border-callout-2';

describe('buildBorderCallout2', () => {
  it('produces a Path2D', () => {
    expect(buildBorderCallout2({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('has 4 adjustments', () => {
    expect(BORDER_CALLOUT_2_ADJUSTMENTS).toHaveLength(4);
  });
});

describe('BORDER_CALLOUT_2_HANDLES', () => {
  it('exposes two handles (bend + target)', () => {
    expect(BORDER_CALLOUT_2_HANDLES.length).toBe(2);
  });
});
