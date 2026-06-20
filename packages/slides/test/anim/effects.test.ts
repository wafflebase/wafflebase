import { describe, it, expect } from 'vitest';
import { sampleEffect } from '../../src/anim/effects';
import { composeAnimStates, IDENTITY } from '../../src/anim/state';

const base = { slideW: 1920, slideH: 1080 };

describe('sampleEffect', () => {
  it('fadeIn ramps opacity, hidden before', () => {
    expect(sampleEffect('fadeIn', { ...base, phase: 'before', progress: 0 }).hidden).toBe(true);
    expect(sampleEffect('fadeIn', { ...base, phase: 'active', progress: 0.5 }).opacity).toBeCloseTo(0.5);
    expect(sampleEffect('fadeIn', { ...base, phase: 'after', progress: 1 }).opacity).toBeCloseTo(1);
  });
  it('fadeOut hides after finishing', () => {
    expect(sampleEffect('fadeOut', { ...base, phase: 'after', progress: 1 }).hidden).toBe(true);
    expect(sampleEffect('fadeOut', { ...base, phase: 'active', progress: 0.5 }).opacity).toBeCloseTo(0.5);
  });
  it('flyIn offsets along direction and lands at 0', () => {
    const s = sampleEffect('flyIn', { ...base, phase: 'active', progress: 0, direction: 'left' });
    expect(s.dx).not.toBe(0);
    const end = sampleEffect('flyIn', { ...base, phase: 'active', progress: 1, direction: 'left' });
    expect(end.dx).toBeCloseTo(0);
  });
});

describe('composeAnimStates', () => {
  it('multiplies opacity/scale and sums dx/dy/rotation', () => {
    const a = { ...IDENTITY, opacity: 0.5, scale: 2, dx: 10, rotation: 1 };
    const b = { ...IDENTITY, opacity: 0.5, scale: 0.5, dx: 5, rotation: 2 };
    const c = composeAnimStates([a, b]);
    expect(c.opacity).toBeCloseTo(0.25);
    expect(c.scale).toBeCloseTo(1);
    expect(c.dx).toBeCloseTo(15);
    expect(c.rotation).toBeCloseTo(3);
  });
  it('hidden if any is hidden', () => {
    expect(composeAnimStates([IDENTITY, { ...IDENTITY, hidden: true }]).hidden).toBe(true);
  });
});
