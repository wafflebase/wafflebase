import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildHorizontalScroll,
  HORIZONTAL_SCROLL_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/horizontal-scroll';

describe('buildHorizontalScroll', () => {
  it('produces a Path2D', () => {
    expect(buildHorizontalScroll({ w: 200, h: 100 })).toBeInstanceOf(Path2D);
  });
});

describe('HORIZONTAL_SCROLL_HANDLES', () => {
  it('exposes one handle', () => {
    expect(HORIZONTAL_SCROLL_HANDLES.length).toBe(1);
  });
});
