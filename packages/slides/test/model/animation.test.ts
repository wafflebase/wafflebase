import { describe, it, expect } from 'vitest';
import type { ObjectAnimation } from '../../src/model/element';
import type { Slide, SlideAnimation, SlideTransition } from '../../src/model/presentation';

describe('animation model', () => {
  it('builds a SlideAnimation from ObjectAnimation + elementId', () => {
    const base: ObjectAnimation = {
      id: 'a1', category: 'entrance', effect: 'fadeIn',
      start: 'onClick', durationMs: 500,
    };
    const sa: SlideAnimation = { ...base, elementId: 'e1' };
    expect(sa.elementId).toBe('e1');
    expect(sa.effect).toBe('fadeIn');
  });

  it('allows a slide with optional transition + animations', () => {
    const t: SlideTransition = { type: 'fade', durationMs: 400 };
    const slide: Slide = {
      id: 's1', layoutId: 'l1',
      background: { fill: { kind: 'role', role: 'background' } },
      elements: [], notes: [],
      transition: t, animations: [],
    };
    expect(slide.transition?.type).toBe('fade');
    expect(slide.animations).toEqual([]);
  });
});
