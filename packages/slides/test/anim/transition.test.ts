import { describe, it, expect } from 'vitest';
import { sampleTransition } from '../../src/anim/transition';

const size = { w: 1920, h: 1080 };

describe('sampleTransition', () => {
  it('fade cross-fades alpha', () => {
    const c = sampleTransition({ type: 'fade', durationMs: 400 }, 0.5, size);
    expect(c.prevAlpha).toBeCloseTo(0.5);
    expect(c.nextAlpha).toBeCloseTo(0.5);
  });
  it('push slides next in from the right by default', () => {
    const c = sampleTransition({ type: 'push', durationMs: 400 }, 0, size);
    expect(c.nextDx).toBeCloseTo(size.w);
    const end = sampleTransition({ type: 'push', durationMs: 400 }, 1, size);
    expect(end.nextDx).toBeCloseTo(0);
  });
});
