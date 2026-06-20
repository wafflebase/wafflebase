import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCurvedUpArrow,
  CURVED_UP_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/curved-up-arrow';

describe('buildCurvedUpArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCurvedUpArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('CURVED_UP_ARROW_HANDLES', () => {
  it('exposes one handle', () => {
    expect(CURVED_UP_ARROW_HANDLES.length).toBe(1);
  });
});
