import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildBentUpArrow,
  BENT_UP_ARROW_HANDLES,
} from './bent-up-arrow';

describe('buildBentUpArrow', () => {
  it('fills the bottom arm + vertical right arm', () => {
    const path = buildBentUpArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Bottom-left of horizontal arm.
    expect(ctx.isPointInPath(path, 30, 185)).toBe(true);
  });
});

describe('BENT_UP_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(BENT_UP_ARROW_HANDLES.length).toBe(2);
  });
});
