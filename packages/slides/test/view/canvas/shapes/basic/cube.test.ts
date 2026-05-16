import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildCube, CUBE_ADJUSTMENTS, CUBE_HANDLES } from '../../../../../src/view/canvas/shapes/basic/cube';

describe('buildCube', () => {
  it('paints the three cube faces, with the SE corner inside the front face', () => {
    const path = buildCube({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 70)).toBe(true);  // front face
    expect(ctx.isPointInPath(path, 50, 10)).toBe(true);  // top face
    expect(ctx.isPointInPath(path, 90, 50)).toBe(true);  // right face
  });

  it('default depth is 25000', () => {
    expect(CUBE_ADJUSTMENTS[0].defaultValue).toBe(25000);
  });
});

describe('CUBE_HANDLES', () => {
  it('exposes one top-edge handle', () => {
    expect(CUBE_HANDLES.length).toBe(1);
  });
});
