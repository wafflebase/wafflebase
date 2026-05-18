import { describe, it, expect } from 'vitest';
import '../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../src/view/canvas/test-canvas-env';
import type { Slide } from '../../../../src/model/presentation';
import type { Element } from '../../../../src/model/element';
import {
  selectAt,
  type SelectAtOptions,
} from '../../../../src/view/editor/interactions/select';

const blankSlide = (elements: Element[]): Slide => ({
  id: 's1', layoutId: 'blank',
  background: { fill: { kind: 'srgb' as const, value: '#fff' } },
  elements,
  notes: [],
});
const rect = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
});
const ellipse = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'ellipse', fill: { kind: 'srgb' as const, value: '#abc' } },
});
const diamond = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'diamond', fill: { kind: 'srgb' as const, value: '#abc' } },
});

const testCtx = createTestCanvas(1, 1).getContext('2d');
const hitOpts: SelectAtOptions = { ctx: testCtx };

describe('selectAt', () => {
  const a = rect('a', 0, 0);
  const b = rect('b', 200, 200);
  const overlapping = rect('c', 50, 50, 50, 50); // sits on top of a
  const slide = blankSlide([a, b, overlapping]);

  it('selects the topmost element under the point (last in array)', () => {
    expect(selectAt(slide, 60, 60, {}, [], hitOpts)).toEqual(['c']);
  });

  it('selects a non-overlapping element', () => {
    expect(selectAt(slide, 250, 250, {}, [], hitOpts)).toEqual(['b']);
  });

  it('clears selection when clicking on empty canvas', () => {
    expect(selectAt(slide, 500, 500, {}, ['a'], hitOpts)).toEqual([]);
  });

  it('shift-click toggles addition to multi-select', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c'], hitOpts)).toEqual(['c', 'b']);
  });

  it('shift-click toggles removal of an already-selected element', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c', 'b'], hitOpts)).toEqual(['c']);
  });

  it('shift-click on empty canvas leaves selection unchanged', () => {
    expect(selectAt(slide, 500, 500, { shift: true }, ['a'], hitOpts)).toEqual(['a']);
  });

  it('clicking an already-selected element preserves the multi-selection', () => {
    // Without this, a no-shift click on one of several selected
    // elements would collapse the selection to just the hit and the
    // follow-up drag would only move that one element.
    expect(selectAt(slide, 250, 250, {}, ['a', 'b'], hitOpts)).toEqual(['a', 'b']);
  });

  it('clicking a non-selected element while others are selected replaces selection', () => {
    expect(selectAt(slide, 60, 60, {}, ['b'], hitOpts)).toEqual(['c']);
  });
});

describe('selectAt — precise shape geometry', () => {
  it('ignores clicks in an ellipse bbox corner outside the ellipse', () => {
    // 100x100 ellipse at origin — the (4, 4) bbox corner is well
    // outside the ellipse (1 = (50-4)²/50² + (50-4)²/50² > 1).
    const slide = blankSlide([ellipse('e', 0, 0)]);
    expect(selectAt(slide, 4, 4, {}, [], hitOpts)).toEqual([]);
  });

  it('selects an ellipse when clicking near its centre', () => {
    const slide = blankSlide([ellipse('e', 0, 0)]);
    expect(selectAt(slide, 50, 50, {}, [], hitOpts)).toEqual(['e']);
  });

  it('ignores clicks in a diamond bbox corner outside the diamond', () => {
    // 100x100 diamond at origin — the (5, 5) bbox corner is well
    // outside the diamond's |x-50|/50 + |y-50|/50 ≤ 1 region.
    const slide = blankSlide([diamond('d', 0, 0)]);
    expect(selectAt(slide, 5, 5, {}, [], hitOpts)).toEqual([]);
  });

  it('selects a diamond when clicking its centre', () => {
    const slide = blankSlide([diamond('d', 0, 0)]);
    expect(selectAt(slide, 50, 50, {}, [], hitOpts)).toEqual(['d']);
  });

  it('falls back to bbox for stroke-only shapes (no fill)', () => {
    // Empty corners of an unfilled ellipse stay clickable in v1 — see
    // task doc for why path-distance hit-test is deferred.
    const outlined: Element = {
      id: 'o', type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'ellipse', stroke: { color: '#000', width: 1 } },
    };
    const slide = blankSlide([outlined]);
    expect(selectAt(slide, 4, 4, {}, [], hitOpts)).toEqual(['o']);
  });
});
