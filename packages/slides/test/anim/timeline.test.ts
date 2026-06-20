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

  it('expands byParagraph animation into N afterPrev-chained items in one step', () => {
    const byParaAnim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'fadeIn',
      start: 'onClick',
      durationMs: 500,
      byParagraph: true,
    };
    const steps = compileTimeline(
      slide([byParaAnim]),
      { paragraphCounts: new Map([['e1', 3]]) },
    );
    // All 3 paragraph copies land in one step (first is onClick, rest are afterPrev).
    expect(steps).toHaveLength(1);
    expect(steps[0].items).toHaveLength(3);
    // First item keeps the original start (onClick → new step boundary).
    expect(steps[0].items[0].anim.start).toBe('onClick');
    expect(steps[0].items[0].anim.id).toBe('a1');
    // Copies are afterPrev with suffixed ids.
    expect(steps[0].items[1].anim.start).toBe('afterPrev');
    expect(steps[0].items[1].anim.id).toBe('a1#1');
    expect(steps[0].items[2].anim.start).toBe('afterPrev');
    expect(steps[0].items[2].anim.id).toBe('a1#2');
    // Chained timing: each copy starts when the previous ends.
    expect(steps[0].items[1].startAtMs).toBe(steps[0].items[0].endAtMs);
    expect(steps[0].items[2].startAtMs).toBe(steps[0].items[1].endAtMs);
  });
});
