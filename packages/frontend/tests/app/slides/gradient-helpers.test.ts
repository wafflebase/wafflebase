import { describe, it, expect } from 'vitest';
import {
  sortStops, insertStopAt, removeStopAt, lerpHex, degToRad, radToDeg,
} from '../../../src/app/slides/fill-picker/gradient-helpers';

const S = (pos: number, hex: string) => ({ pos, color: { kind: 'srgb' as const, value: hex } });

describe('gradient-helpers', () => {
  it('lerpHex blends two colors at t', () => {
    expect(lerpHex('#000000', '#ffffff', 0.5).toLowerCase()).toBe('#808080');
  });

  it('lerpHex clamps out-of-range t to the endpoint colors', () => {
    expect(lerpHex('#000000', '#ffffff', 1.5)).toBe('#ffffff');
    expect(lerpHex('#000000', '#ffffff', -0.5)).toBe('#000000');
  });

  it('insertStopAt places a stop with a color interpolated from neighbors', () => {
    const out = insertStopAt([S(0, '#000000'), S(1, '#ffffff')], 0.5);
    expect(out).toHaveLength(3);
    const mid = out.find((s) => s.pos === 0.5)!;
    expect(mid.color.kind).toBe('srgb');
    expect((mid.color as { kind: 'srgb'; value: string }).value.toLowerCase()).toBe('#808080');
  });

  it('removeStopAt is a no-op at the 2-stop floor', () => {
    const two = [S(0, '#000'), S(1, '#fff')];
    expect(removeStopAt(two, 0)).toHaveLength(2);
  });

  it('removeStopAt drops the stop when >2', () => {
    const three = [S(0, '#000'), S(0.5, '#888'), S(1, '#fff')];
    expect(removeStopAt(three, 1)).toHaveLength(2);
  });

  it('sortStops orders by pos ascending', () => {
    expect(sortStops([S(1, '#fff'), S(0, '#000')]).map((s) => s.pos)).toEqual([0, 1]);
  });

  it('deg<->rad round-trips', () => {
    expect(radToDeg(degToRad(45))).toBeCloseTo(45);
  });
});
