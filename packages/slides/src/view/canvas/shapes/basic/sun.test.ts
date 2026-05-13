import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildSun, SUN_ADJUSTMENTS, SUN_HANDLES } from './sun';

describe('buildSun', () => {
  it('fills the central disc', () => {
    const path = buildSun({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
  });

  it('default ray length is 25000', () => {
    expect(SUN_ADJUSTMENTS[0].defaultValue).toBe(25000);
  });
});

describe('SUN_HANDLES', () => {
  it('exposes one handle on the inner radius', () => {
    expect(SUN_HANDLES.length).toBe(1);
  });
});
