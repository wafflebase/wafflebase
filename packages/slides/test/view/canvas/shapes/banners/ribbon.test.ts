import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildRibbon, RIBBON_HANDLES } from '../../../../../src/view/canvas/shapes/banners/ribbon';

describe('buildRibbon', () => {
  it('fills the body centre', () => {
    const path = buildRibbon({ w: 200, h: 100 });
    const ctx = createTestCanvas(400, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true);
  });
});

describe('RIBBON_HANDLES', () => {
  it('exposes two handles', () => {
    expect(RIBBON_HANDLES.length).toBe(2);
  });
});
