import { describe, it, expect } from 'vitest';
import { compileTimeline } from '../../src/anim/timeline';
import type { Slide, SlideAnimation } from '../../src/model/presentation';

const a = (id: string, start: SlideAnimation['start'], dur = 500, delay = 0): SlideAnimation => ({
  id, elementId: 'e' + id, category: 'entrance', effect: 'fadeIn',
  start, durationMs: dur, delayMs: delay,
});
const slide = (anims: SlideAnimation[]): Slide => ({
  id: 's', layoutId: 'l', background: { fill: { kind: 'role', role: 'background' } },
  elements: [], notes: [], animations: anims,
});

describe('compileTimeline', () => {
  it('splits steps on onClick', () => {
    const steps = compileTimeline(slide([a('1','onClick'), a('2','onClick')]));
    expect(steps).toHaveLength(2);
  });
  it('withPrev shares the previous startAt within the same step', () => {
    const steps = compileTimeline(slide([a('1','onClick'), a('2','withPrev')]));
    expect(steps).toHaveLength(1);
    expect(steps[0].items[1].startAtMs).toBe(steps[0].items[0].startAtMs);
  });
  it('afterPrev starts at previous endAt', () => {
    const steps = compileTimeline(slide([a('1','onClick',500), a('2','afterPrev',300)]));
    expect(steps[0].items[1].startAtMs).toBe(steps[0].items[0].endAtMs);
    expect(steps[0].items[1].endAtMs).toBe(steps[0].items[0].endAtMs + 300);
  });
  it('applies delayMs to startAt', () => {
    const steps = compileTimeline(slide([a('1','onClick',500,200)]));
    expect(steps[0].items[0].startAtMs).toBe(200);
    expect(steps[0].items[0].endAtMs).toBe(700);
  });
  it('skips animations whose element no longer exists', () => {
    const steps = compileTimeline(slide([a('1','onClick')]), { existingElementIds: new Set() });
    expect(steps).toHaveLength(0);
  });
});
