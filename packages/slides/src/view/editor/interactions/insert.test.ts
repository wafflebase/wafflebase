import { describe, it, expect } from 'vitest';
import { buildInsertElement } from './insert';

describe('buildInsertElement — drag-shaped shapes', () => {
  it('builds a rect from the drag rectangle', () => {
    const init = buildInsertElement('rect', { x: 10, y: 20 }, { x: 110, y: 80 });
    expect(init).toEqual({
      type: 'shape',
      frame: { x: 10, y: 20, w: 100, h: 60, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb', value: '#cccccc' } },
    });
  });
  it('builds an ellipse the same way', () => {
    const init = buildInsertElement('ellipse', { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(init).toEqual({
      type: 'shape',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      data: { kind: 'ellipse', fill: { kind: 'srgb', value: '#cccccc' } },
    });
  });
  it('normalises a backwards drag', () => {
    const init = buildInsertElement('rect', { x: 100, y: 100 }, { x: 50, y: 60 });
    expect(init.frame).toEqual({ x: 50, y: 60, w: 50, h: 40, rotation: 0 });
  });
});

describe('buildInsertElement — line and arrow', () => {
  it('places line/arrow as a thin box from start to end', () => {
    const line = buildInsertElement('line', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(line.type).toBe('shape');
    expect(line.frame.w).toBe(100);
    expect(line.frame.h).toBe(50);
    if (line.type === 'shape' && line.data.kind === 'line') {
      expect(line.data.stroke?.width).toBe(2);
    }
  });
});

describe('buildInsertElement — text', () => {
  it('returns a default-sized text box anchored at the start point', () => {
    const text = buildInsertElement('text', { x: 50, y: 50 }, { x: 50, y: 50 });
    expect(text.type).toBe('text');
    expect(text.frame.w).toBe(400);
    expect(text.frame.h).toBe(80);
    expect(text.frame.x).toBe(50);
    expect(text.frame.y).toBe(50);
  });
});
