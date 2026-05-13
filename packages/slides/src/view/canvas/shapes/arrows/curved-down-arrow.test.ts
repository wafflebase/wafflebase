import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import {
  buildCurvedDownArrow,
  CURVED_DOWN_ARROW_HANDLES,
} from './curved-down-arrow';

describe('buildCurvedDownArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCurvedDownArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('CURVED_DOWN_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(CURVED_DOWN_ARROW_HANDLES.length).toBe(2);
  });
});
