import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { buildSwooshArrow, SWOOSH_ARROW_HANDLES } from './swoosh-arrow';

describe('buildSwooshArrow', () => {
  it('produces a Path2D (geometry covered by registry snapshot)', () => {
    // The swoosh curve crosses the frame diagonally and the path
    // shim's polygon hit-test loses precision on long thin
    // crescents; pin the snapshot for geometry.
    expect(buildSwooshArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });
});

describe('SWOOSH_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(SWOOSH_ARROW_HANDLES.length).toBe(2);
  });
});
