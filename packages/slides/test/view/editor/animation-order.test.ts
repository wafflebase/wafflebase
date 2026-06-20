import { describe, it, expect } from 'vitest';
import { computeAnimationOrder } from '../../../src/view/editor/animation-order';
import type { SlideAnimation } from '../../../src/model/presentation';

function anim(elementId: string): SlideAnimation {
  return {
    id: `anim-${elementId}-${Math.random()}`,
    elementId,
    category: 'entrance',
    effect: 'appear',
    start: 'onClick',
    durationMs: 500,
  };
}

describe('computeAnimationOrder', () => {
  it('returns an empty map for undefined', () => {
    const result = computeAnimationOrder(undefined);
    expect(result.size).toBe(0);
  });

  it('returns an empty map for an empty array', () => {
    const result = computeAnimationOrder([]);
    expect(result.size).toBe(0);
  });

  it('maps a single animation to position 1', () => {
    const result = computeAnimationOrder([anim('a')]);
    expect(result.get('a')).toEqual([1]);
  });

  it('assigns correct 1-based positions across multiple elements', () => {
    const animations: SlideAnimation[] = [anim('a'), anim('b'), anim('a')];
    const result = computeAnimationOrder(animations);
    expect(result.get('a')).toEqual([1, 3]);
    expect(result.get('b')).toEqual([2]);
  });

  it('handles all animations belonging to the same element', () => {
    const animations: SlideAnimation[] = [anim('x'), anim('x'), anim('x')];
    const result = computeAnimationOrder(animations);
    expect(result.get('x')).toEqual([1, 2, 3]);
  });

  it('preserves sequence order for multiple distinct elements', () => {
    const animations: SlideAnimation[] = [anim('c'), anim('a'), anim('b')];
    const result = computeAnimationOrder(animations);
    expect(result.get('c')).toEqual([1]);
    expect(result.get('a')).toEqual([2]);
    expect(result.get('b')).toEqual([3]);
  });
});
