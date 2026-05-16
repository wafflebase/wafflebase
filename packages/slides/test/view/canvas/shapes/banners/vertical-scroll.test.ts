import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildVerticalScroll,
  VERTICAL_SCROLL_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/vertical-scroll';

describe('buildVerticalScroll', () => {
  it('produces a Path2D', () => {
    expect(buildVerticalScroll({ w: 100, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('VERTICAL_SCROLL_HANDLES', () => {
  it('exposes one handle', () => {
    expect(VERTICAL_SCROLL_HANDLES.length).toBe(1);
  });
});
