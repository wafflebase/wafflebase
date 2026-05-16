import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCurvedLeftArrow,
  CURVED_LEFT_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/curved-left-arrow';

describe('buildCurvedLeftArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCurvedLeftArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('CURVED_LEFT_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(CURVED_LEFT_ARROW_HANDLES.length).toBe(2);
  });
});
