import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../src/model/element';
import { smartGuides } from '../../../src/view/editor/smart-guides';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});
void f;

describe('smartGuides (skeleton)', () => {
  it('returns the dx/dy unchanged and an empty guide list when others is empty', () => {
    const bbox = { x: 100, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 7, 11, []);
    expect(out.dx).toBe(7);
    expect(out.dy).toBe(11);
    expect(out.guides).toEqual([]);
  });
});
