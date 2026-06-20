import { describe, it, expect } from 'vitest';
import { sampleStep, stepDurationMs } from '../../src/anim/sample';
import type { Step } from '../../src/anim/timeline';

const step: Step = { items: [
  { anim: { id:'1', elementId:'e1', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:500 }, startAtMs: 0, endAtMs: 500 },
]};

describe('sampleStep', () => {
  it('is hidden before start and full after end', () => {
    expect(sampleStep(step, -1, { w:1920, h:1080 }).get('e1')!.hidden).toBe(true);
    expect(sampleStep(step, 250, { w:1920, h:1080 }).get('e1')!.opacity).toBeGreaterThan(0);
    expect(sampleStep(step, 600, { w:1920, h:1080 }).get('e1')!.opacity).toBeCloseTo(1);
  });
  it('reports total duration', () => {
    expect(stepDurationMs(step)).toBe(500);
  });

  // Composition end-to-end: spin + fadeIn both withPrev on the same element.
  // composeAnimStates is unit-tested in effects.test.ts; this test covers the
  // full sampleStep path where two ScheduledAnim items share an elementId and
  // their individual AnimStates are reduced via composeAnimStates.
  it('two overlapping animations on one element compose rotation AND opacity', () => {
    // spin starts at 0 ms, duration 1000 ms → at mid-step (500 ms) progress=0.5
    //   spin effect: rotation = 0.5 * 2π = π, hidden = false (phase='active')
    // fadeIn starts at 0 ms (withPrev), duration 1000 ms → at mid-step progress=0.5
    //   fadeIn effect: opacity = 0.5, hidden = false (phase='active')
    // compose: rotation = 0 + π + 0 = π, opacity = 1 * 1 * 0.5 = 0.5
    const twoAnimStep: Step = {
      items: [
        {
          anim: { id: 'a1', elementId: 'e1', category: 'emphasis', effect: 'spin', start: 'onClick', durationMs: 1000 },
          startAtMs: 0,
          endAtMs: 1000,
        },
        {
          anim: { id: 'a2', elementId: 'e1', category: 'entrance', effect: 'fadeIn', start: 'withPrev', durationMs: 1000 },
          startAtMs: 0,
          endAtMs: 1000,
        },
      ],
    };

    const result = sampleStep(twoAnimStep, 500, { w: 1920, h: 1080 });
    const state = result.get('e1');
    expect(state).toBeDefined();
    // rotation > 0: spin at progress=0.5 contributes 0.5 * 2π > 0
    expect(state!.rotation).toBeGreaterThan(0);
    // opacity strictly between 0 and 1: fadeIn at progress=0.5 contributes 0.5
    expect(state!.opacity).toBeGreaterThan(0);
    expect(state!.opacity).toBeLessThan(1);
    // element is visible (spin sets hidden=false when active, fadeIn sets hidden=false when active)
    expect(state!.hidden).toBe(false);
  });
});
