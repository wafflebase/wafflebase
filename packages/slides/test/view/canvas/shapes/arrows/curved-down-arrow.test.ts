import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCurvedDownArrow,
  CURVED_DOWN_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/curved-down-arrow';

describe('buildCurvedDownArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCurvedDownArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('CURVED_DOWN_ARROW_HANDLES', () => {
  it('exposes three handles (thickness + head width + head length)', () => {
    expect(CURVED_DOWN_ARROW_HANDLES.length).toBe(3);
  });
});
