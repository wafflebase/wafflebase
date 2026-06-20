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
});
