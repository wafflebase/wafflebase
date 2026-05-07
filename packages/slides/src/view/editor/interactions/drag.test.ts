import { describe, it, expect } from 'vitest';
import type { Element } from '../../../model/element';
import { applyDrag } from './drag';

const at = (id: string, x: number, y: number): Element => ({
  id, type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
});

describe('applyDrag', () => {
  it('applies the same delta to every selected element', () => {
    const result = applyDrag([at('a', 0, 0), at('b', 200, 100)], 50, 30);
    expect(result.map((e) => ({ id: e.id, x: e.frame.x, y: e.frame.y }))).toEqual([
      { id: 'a', x: 50, y: 30 },
      { id: 'b', x: 250, y: 130 },
    ]);
  });

  it('preserves rotation and size', () => {
    const original: Element = {
      ...at('a', 0, 0),
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 4 },
    };
    const result = applyDrag([original], 10, 10);
    expect(result[0].frame.rotation).toBe(Math.PI / 4);
    expect(result[0].frame.w).toBe(100);
    expect(result[0].frame.h).toBe(100);
  });

  it('returns a new array — does not mutate inputs', () => {
    const input = [at('a', 0, 0)];
    const result = applyDrag(input, 1, 2);
    expect(result).not.toBe(input);
    expect(input[0].frame.x).toBe(0); // unchanged
  });
});
