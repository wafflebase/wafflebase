import { describe, it, expect } from 'vitest';
import { sampleStep, sampleTimeline, stepDurationMs } from '../../src/anim/sample';
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

describe('sampleTimeline', () => {
  const slide = { w: 1920, h: 1080 };

  // step0: fadeIn on 'a' (onClick), step1: fadeIn on 'b' (onClick)
  const step0: Step = { items: [
    { anim: { id:'s0', elementId:'a', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:500 }, startAtMs:0, endAtMs:500 },
  ]};
  const step1: Step = { items: [
    { anim: { id:'s1', elementId:'b', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:500 }, startAtMs:0, endAtMs:500 },
  ]};
  const steps = [step0, step1];

  it('currentIndex=-1: both entrance elements are hidden (nothing played yet)', () => {
    const result = sampleTimeline(steps, -1, 0, slide);
    // No steps are current; both are future → before → hidden.
    expect(result.get('a')?.hidden).toBe(true);
    expect(result.get('b')?.hidden).toBe(true);
  });

  it('currentIndex=0 at end: element a is visible, element b is still hidden', () => {
    const result = sampleTimeline(steps, 0, 500, slide);
    // step0 sampled at end → a: opacity=1, hidden=false.
    expect(result.get('a')?.hidden).toBe(false);
    expect(result.get('a')?.opacity).toBeCloseTo(1);
    // step1 is future → b is still hidden.
    expect(result.get('b')?.hidden).toBe(true);
  });

  it('currentIndex=1 at end: both elements are visible', () => {
    const result = sampleTimeline(steps, 1, 500, slide);
    // step0 is past (sampled at end) → a visible.
    expect(result.get('a')?.hidden).toBe(false);
    expect(result.get('a')?.opacity).toBeCloseTo(1);
    // step1 sampled at end → b visible.
    expect(result.get('b')?.hidden).toBe(false);
    expect(result.get('b')?.opacity).toBeCloseTo(1);
  });

  it('element with entrance in step0 + fadeOut exit in step1: hidden after step1 completes', () => {
    // 'c' enters (fadeIn) in step0, exits (fadeOut) in step1.
    const stepsWithExit: Step[] = [
      { items: [
        { anim: { id:'e0', elementId:'c', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:500 }, startAtMs:0, endAtMs:500 },
      ]},
      { items: [
        { anim: { id:'e1', elementId:'c', category:'exit', effect:'fadeOut', start:'onClick', durationMs:500 }, startAtMs:0, endAtMs:500 },
      ]},
    ];

    // After step1 completes (currentIndex=1, elapsed=500):
    // step0 → after: opacity=1, hidden=false
    // step1 → after: fadeOut → hidden=true (phase='after')
    // compose: hidden = false || true = true
    const result = sampleTimeline(stepsWithExit, 1, 500, slide);
    expect(result.get('c')?.hidden).toBe(true);
  });

  it('currentIndex=0 mid-animation: element a is partially visible, b is hidden', () => {
    const result = sampleTimeline(steps, 0, 250, slide);
    // step0 mid → a: 0 < opacity < 1, not hidden.
    const stateA = result.get('a');
    expect(stateA?.hidden).toBe(false);
    expect(stateA?.opacity).toBeGreaterThan(0);
    expect(stateA?.opacity).toBeLessThan(1);
    // step1 is future → b hidden.
    expect(result.get('b')?.hidden).toBe(true);
  });
});
