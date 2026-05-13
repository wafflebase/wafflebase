import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import {
  buildLeftRightRibbon,
  LEFT_RIGHT_RIBBON_ADJUSTMENTS,
  LEFT_RIGHT_RIBBON_HANDLES,
} from './left-right-ribbon';

describe('buildLeftRightRibbon', () => {
  it('produces a Path2D', () => {
    expect(buildLeftRightRibbon({ w: 200, h: 100 })).toBeInstanceOf(Path2D);
  });

  it('has three adjustments', () => {
    expect(LEFT_RIGHT_RIBBON_ADJUSTMENTS).toHaveLength(3);
  });
});

describe('LEFT_RIGHT_RIBBON_HANDLES', () => {
  it('exposes three handles', () => {
    expect(LEFT_RIGHT_RIBBON_HANDLES.length).toBe(3);
  });
});
