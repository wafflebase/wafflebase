import { describe, it, expect } from 'vitest';
import type { Slide } from '../../../model/presentation';
import type { Element } from '../../../model/element';
import { selectAt } from './select';

const blankSlide = (elements: Element[]): Slide => ({
  id: 's1', layoutId: 'blank',
  background: { fill: '#fff' },
  elements,
  notes: [],
});
const rect = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('selectAt', () => {
  const a = rect('a', 0, 0);
  const b = rect('b', 200, 200);
  const overlapping = rect('c', 50, 50, 50, 50); // sits on top of a
  const slide = blankSlide([a, b, overlapping]);

  it('selects the topmost element under the point (last in array)', () => {
    expect(selectAt(slide, 60, 60, {}, [])).toEqual(['c']);
  });

  it('selects a non-overlapping element', () => {
    expect(selectAt(slide, 250, 250, {}, [])).toEqual(['b']);
  });

  it('clears selection when clicking on empty canvas', () => {
    expect(selectAt(slide, 500, 500, {}, ['a'])).toEqual([]);
  });

  it('shift-click toggles addition to multi-select', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c'])).toEqual(['c', 'b']);
  });

  it('shift-click toggles removal of an already-selected element', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c', 'b'])).toEqual(['c']);
  });

  it('shift-click on empty canvas leaves selection unchanged', () => {
    expect(selectAt(slide, 500, 500, { shift: true }, ['a'])).toEqual(['a']);
  });
});
