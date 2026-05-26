import { describe, it, expect } from 'vitest';
import type { Element } from '../../../../src/model/element';
import { translateElement } from '../../../../src/view/editor/interactions/drag';

const shape = (id: string, x: number, y: number): Element => ({
  id, type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
});

describe('translateElement', () => {
  it('translates a shape\'s frame', () => {
    const result = translateElement(shape('a', 100, 100), 50, 30);
    expect(result.frame.x).toBe(150);
    expect(result.frame.y).toBe(130);
  });

  it('preserves rotation and size', () => {
    const original: Element = {
      ...shape('a', 0, 0),
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 4 },
    };
    const result = translateElement(original, 10, 10);
    expect(result.frame.rotation).toBe(Math.PI / 4);
    expect(result.frame.w).toBe(100);
    expect(result.frame.h).toBe(100);
  });

  it('does not mutate the input', () => {
    const original = shape('a', 0, 0);
    translateElement(original, 1, 2);
    expect(original.frame.x).toBe(0);
  });

  it('translates a connector\'s free endpoints and cached frame', () => {
    const connector: Element = {
      id: 'c',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'free', x: 100, y: 100 },
      end:   { kind: 'free', x: 300, y: 200 },
      arrowheads: {},
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
    };
    const result = translateElement(connector, 20, -10);
    if (result.type !== 'connector') throw new Error('unreachable');
    expect(result.start).toEqual({ kind: 'free', x: 120, y: 90 });
    expect(result.end).toEqual({ kind: 'free', x: 320, y: 190 });
    expect(result.frame.x).toBe(120);
    expect(result.frame.y).toBe(90);
  });

  it('leaves attached endpoints anchored to their host', () => {
    const connector: Element = {
      id: 'c',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'attached', elementId: 'host', siteIndex: 0 },
      end:   { kind: 'free', x: 300, y: 200 },
      arrowheads: {},
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
    };
    const result = translateElement(connector, 20, -10);
    if (result.type !== 'connector') throw new Error('unreachable');
    // start is untouched — the renderer keeps it pinned to its host.
    expect(result.start).toEqual({ kind: 'attached', elementId: 'host', siteIndex: 0 });
    expect(result.end).toEqual({ kind: 'free', x: 320, y: 190 });
  });
});
