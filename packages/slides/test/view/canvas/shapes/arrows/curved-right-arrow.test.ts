import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCurvedRightArrow,
  CURVED_RIGHT_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/curved-right-arrow';

describe('buildCurvedRightArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCurvedRightArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('CURVED_RIGHT_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(CURVED_RIGHT_ARROW_HANDLES.length).toBe(2);
  });
});
