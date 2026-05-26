import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { buildRibbon2, RIBBON2_HANDLES } from '../../../../../src/view/canvas/shapes/banners/ribbon2';

describe('buildRibbon2', () => {
  it('produces a Path2D', () => {
    expect(buildRibbon2({ w: 200, h: 100 })).toBeInstanceOf(Path2D);
  });
});

describe('RIBBON2_HANDLES', () => {
  it('exposes two handles', () => {
    expect(RIBBON2_HANDLES.length).toBe(2);
  });
});
