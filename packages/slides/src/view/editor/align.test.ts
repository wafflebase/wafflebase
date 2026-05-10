import { describe, it, expect } from 'vitest';
import type { Frame } from '../../model/element';
import { alignFrames, distributeFrames } from './align';

const f = (
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
): Frame => ({ x, y, w, h, rotation });

const SLIDE = { x: 0, y: 0, w: 1920, h: 1080 };

describe('alignFrames', () => {
  it('center-h on slide reference centers a single element horizontally', () => {
    // (1920 - 200) / 2 = 860
    const frames = new Map<string, Frame>([['only', f(0, 0, 200, 100)]]);
    const result = alignFrames(frames, 'center-h', SLIDE);
    expect(result.size).toBe(1);
    expect(result.get('only')).toEqual(f(860, 0, 200, 100));
  });

  it('center-v on slide reference centers a single element vertically', () => {
    // (1080 - 100) / 2 = 490
    const frames = new Map<string, Frame>([['only', f(0, 0, 200, 100)]]);
    const result = alignFrames(frames, 'center-v', SLIDE);
    expect(result.size).toBe(1);
    expect(result.get('only')).toEqual(f(0, 490, 200, 100));
  });

  describe('multi-element bbox reference', () => {
    // Selection bbox is exactly { x:0, y:0, w:300, h:200 }.
    const a = f(0, 0, 100, 50);
    const b = f(200, 150, 100, 50);
    const frames = new Map<string, Frame>([
      ['a', a],
      ['b', b],
    ]);
    const ref = { x: 0, y: 0, w: 300, h: 200 };

    it('left moves only b (a is already at the left edge)', () => {
      const result = alignFrames(frames, 'left', ref);
      expect(result.has('a')).toBe(false);
      expect(result.get('b')).toEqual(f(0, 150, 100, 50));
    });

    it('center-h centers both elements', () => {
      // (0 + 300/2) - 100/2 = 100
      const result = alignFrames(frames, 'center-h', ref);
      expect(result.get('a')).toEqual(f(100, 0, 100, 50));
      expect(result.get('b')).toEqual(f(100, 150, 100, 50));
    });

    it('right moves only a (b is already at the right edge)', () => {
      // 0 + 300 - 100 = 200
      const result = alignFrames(frames, 'right', ref);
      expect(result.get('a')).toEqual(f(200, 0, 100, 50));
      expect(result.has('b')).toBe(false);
    });

    it('top moves only b (a is already at the top edge)', () => {
      const result = alignFrames(frames, 'top', ref);
      expect(result.has('a')).toBe(false);
      expect(result.get('b')).toEqual(f(200, 0, 100, 50));
    });

    it('center-v centers both elements vertically', () => {
      // (0 + 200/2) - 50/2 = 75
      const result = alignFrames(frames, 'center-v', ref);
      expect(result.get('a')).toEqual(f(0, 75, 100, 50));
      expect(result.get('b')).toEqual(f(200, 75, 100, 50));
    });

    it('bottom moves only a (b is already at the bottom edge)', () => {
      // 0 + 200 - 50 = 150
      const result = alignFrames(frames, 'bottom', ref);
      expect(result.get('a')).toEqual(f(0, 150, 100, 50));
      expect(result.has('b')).toBe(false);
    });
  });

  it('omits frames already at the target edge (no-op skip)', () => {
    const frames = new Map<string, Frame>([
      ['already', f(0, 0, 100, 50)],
      ['needs', f(50, 0, 100, 50)],
    ]);
    const result = alignFrames(frames, 'left', { x: 0, y: 0, w: 300, h: 200 });
    expect(result.has('already')).toBe(false);
    expect(result.get('needs')).toEqual(f(0, 0, 100, 50));
  });

  it('preserves all frame fields including rotation', () => {
    const frames = new Map<string, Frame>([
      ['only', f(50, 50, 100, 50, 0.7853981633974483)],
    ]);
    const result = alignFrames(frames, 'left', { x: 0, y: 0, w: 300, h: 200 });
    expect(result.get('only')).toEqual({
      x: 0,
      y: 50,
      w: 100,
      h: 50,
      rotation: 0.7853981633974483,
    });
  });
});

describe('distributeFrames', () => {
  it('distributes 3 horizontal frames with equal gaps', () => {
    const frames = new Map<string, Frame>([
      ['a', f(0, 0, 100, 50)],
      ['b', f(150, 0, 50, 50)],
      ['c', f(400, 0, 100, 50)],
    ]);
    // gap = (400 - 0 - (100 + 50)) / 2 = 125
    // new x_b = 0 + 100 + 1 * 125 = 225
    const result = distributeFrames(frames, 'horizontal');
    expect(result.get('b')).toEqual(f(225, 0, 50, 50));
    expect(result.has('a')).toBe(false); // endpoint
    expect(result.has('c')).toBe(false); // endpoint
  });

  it('distributes 3 vertical frames with equal gaps', () => {
    const frames = new Map<string, Frame>([
      ['a', f(0, 0, 50, 100)],
      ['b', f(0, 150, 50, 50)],
      ['c', f(0, 400, 50, 100)],
    ]);
    // gap = (400 - 0 - (100 + 50)) / 2 = 125
    // new y_b = 0 + 100 + 1 * 125 = 225
    const result = distributeFrames(frames, 'vertical');
    expect(result.get('b')).toEqual(f(0, 225, 50, 50));
    expect(result.has('a')).toBe(false);
    expect(result.has('c')).toBe(false);
  });

  it('distributes 4 horizontal frames with equal gaps and skips no-ops', () => {
    // Sorted by x: a (x=0, w=10), b (x=90, w=20), c (x=180, w=30),
    //              d (x=300, w=10). Inner widths sum (excluding last)
    //              = 10+20+30 = 60. gap = (300 - 0 - 60) / 3 = 80.
    // new x_b = 0 + 10 + 1*80 = 90  (already there → no-op)
    // new x_c = 0 + 10 + 20 + 2*80 = 190 (needs to move from 180)
    const frames = new Map<string, Frame>([
      ['a', f(0, 0, 10, 10)],
      ['b', f(90, 0, 20, 10)], // already in correct position (no-op)
      ['c', f(180, 0, 30, 10)], // needs to move to x=190
      ['d', f(300, 0, 10, 10)],
    ]);
    const result = distributeFrames(frames, 'horizontal');
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(false); // no-op skipped
    expect(result.get('c')).toEqual(f(190, 0, 30, 10));
    expect(result.has('d')).toBe(false);
  });

  it('returns empty map for fewer than 3 frames', () => {
    expect(distributeFrames(new Map(), 'horizontal').size).toBe(0);
    expect(
      distributeFrames(
        new Map<string, Frame>([['a', f(0, 0, 10, 10)]]),
        'horizontal',
      ).size,
    ).toBe(0);
    expect(
      distributeFrames(
        new Map<string, Frame>([
          ['a', f(0, 0, 10, 10)],
          ['b', f(50, 0, 10, 10)],
        ]),
        'horizontal',
      ).size,
    ).toBe(0);
  });

  it('ignores Map iteration order; sorts by leading edge', () => {
    // Insert in c, a, b order — same fixture as the happy-path horizontal.
    const frames = new Map<string, Frame>([
      ['c', f(400, 0, 100, 50)],
      ['a', f(0, 0, 100, 50)],
      ['b', f(150, 0, 50, 50)],
    ]);
    const result = distributeFrames(frames, 'horizontal');
    expect(result.get('b')).toEqual(f(225, 0, 50, 50));
    expect(result.has('a')).toBe(false);
    expect(result.has('c')).toBe(false);
  });

  it('preserves rotation and other frame fields when moving', () => {
    const frames = new Map<string, Frame>([
      ['a', f(0, 0, 100, 50)],
      ['b', f(150, 0, 50, 50, 1.5)],
      ['c', f(400, 0, 100, 50)],
    ]);
    const result = distributeFrames(frames, 'horizontal');
    expect(result.get('b')).toEqual({
      x: 225,
      y: 0,
      w: 50,
      h: 50,
      rotation: 1.5,
    });
  });

  it('allows negative gaps (overlap) without clamping', () => {
    // 3 frames where the inner element will overlap due to a tight span.
    // x_0=0,w_0=100; x_2=120,w_2=100. Inner b w=50.
    // gap = (120 - 0 - (100 + 50)) / 2 = -15
    // new x_b = 0 + 100 + 1 * -15 = 85 (overlaps the right end of a at 100)
    const frames = new Map<string, Frame>([
      ['a', f(0, 0, 100, 50)],
      ['b', f(40, 0, 50, 50)],
      ['c', f(120, 0, 100, 50)],
    ]);
    const result = distributeFrames(frames, 'horizontal');
    expect(result.get('b')).toEqual(f(85, 0, 50, 50));
  });
});
