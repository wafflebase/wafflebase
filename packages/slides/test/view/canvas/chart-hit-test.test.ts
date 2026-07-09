// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../src/view/canvas/test-canvas-env';
import { hitTestSlide } from '../../../src/view/editor/hit-test-elements';
import type { ChartElement } from '../../../src/model/element';
import type { Slide } from '../../../src/model/presentation';

const ctx = createTestCanvas(1, 1).getContext('2d');
const hitOpts = { ctx };

function chart(id: string, frame: { x: number; y: number; w: number; h: number }): ChartElement {
  return {
    id,
    type: 'chart',
    frame: { rotation: 0, ...frame },
    data: {
      kind: 'column',
      categories: ['a'],
      series: [{ values: [1] }],
    },
  };
}

function slide(elements: Slide['elements']): Slide {
  return {
    id: 'sl',
    layoutId: 'blank',
    background: { kind: 'fill', fill: { type: 'srgb', value: '#fff' } } as unknown as Slide['background'],
    elements,
    notes: [],
  };
}

// Charts are plain framed elements (like tables): `hitTestElement` falls
// through its `el.type !== 'shape'` branch straight to `containsPoint`, so
// no chart-specific hit-test code exists or is needed — this test is the
// guard that the default bbox path keeps covering `type: 'chart'` as new
// element types are added to `hitTestElement`'s branching.
describe('hitTestSlide — chart', () => {
  it('resolves a point inside the chart frame to the chart', () => {
    const c = chart('c1', { x: 100, y: 100, w: 200, h: 150 });
    const hit = hitTestSlide(slide([c]), 150, 150, hitOpts);
    expect(hit?.elementId).toBe('c1');
    expect(hit?.ancestorPath).toEqual(['c1']);
  });

  it('does not resolve a point outside the chart frame', () => {
    const c = chart('c1', { x: 100, y: 100, w: 200, h: 150 });
    expect(hitTestSlide(slide([c]), 50, 50, hitOpts)).toBeNull();
  });

  it('resolves a chart nested inside a rotated group via the group transform', () => {
    const c = chart('c1', { x: 0, y: 0, w: 100, h: 100 });
    const group: Slide['elements'][number] = {
      id: 'g1',
      type: 'group',
      frame: { x: 50, y: 50, w: 100, h: 100, rotation: 0 },
      data: { children: [c] },
    };
    // world (55, 55) -> group-local (5, 5) -> inside the chart's local frame.
    const hit = hitTestSlide(slide([group]), 55, 55, hitOpts);
    expect(hit?.elementId).toBe('c1');
    expect(hit?.ancestorPath).toEqual(['g1', 'c1']);
  });
});
