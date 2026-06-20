import { describe, it, expect } from 'vitest';
import type { Crop } from '../../src/model/element';
import {
  cropToFull,
  windowToCrop,
  applyCropHandle,
  panFull,
  normalizeCrop,
  resetFrameForUncrop,
  effectiveCrop,
  type Rect,
} from '../../src/model/image-crop';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('effectiveCrop', () => {
  it('defaults to the whole image', () => {
    expect(effectiveCrop(undefined)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('cropToFull', () => {
  it('returns the frame itself for an uncropped image', () => {
    expect(cropToFull(r(100, 50, 400, 300), undefined)).toEqual(
      r(100, 50, 400, 300),
    );
  });

  it('expands to the full bitmap for a centered half crop', () => {
    // crop shows the centre 50%×50% → full bitmap is 2× in each axis,
    // offset so the window sits in the middle.
    const crop: Crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const full = cropToFull(r(100, 100, 200, 200), crop);
    expect(full.w).toBeCloseTo(400);
    expect(full.h).toBeCloseTo(400);
    expect(full.x).toBeCloseTo(100 - 0.25 * 400); // 0
    expect(full.y).toBeCloseTo(0);
  });
});

describe('windowToCrop ∘ cropToFull round-trip', () => {
  it('recovers the original crop', () => {
    const frame = r(120, 80, 360, 240);
    const crop: Crop = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
    const full = cropToFull(frame, crop);
    const back = windowToCrop(full, frame);
    expect(back.x).toBeCloseTo(crop.x);
    expect(back.y).toBeCloseTo(crop.y);
    expect(back.w).toBeCloseTo(crop.w);
    expect(back.h).toBeCloseTo(crop.h);
  });
});

describe('applyCropHandle', () => {
  const full = r(0, 0, 400, 400);
  const window = r(0, 0, 400, 400); // start uncropped

  it('trims from the east edge, keeping the west anchor fixed', () => {
    const next = applyCropHandle(full, window, 'e', -100, 0);
    expect(next).toEqual(r(0, 0, 300, 400));
  });

  it('trims from the north-west corner', () => {
    const next = applyCropHandle(full, window, 'nw', 50, 80);
    expect(next).toEqual(r(50, 80, 350, 320));
  });

  it('clamps a moved edge to the full-bitmap bound', () => {
    const next = applyCropHandle(full, window, 'w', -100, 0);
    expect(next.x).toBe(0); // cannot go past the bitmap's left edge
    expect(next.w).toBe(400);
  });

  it('respects the minimum window size', () => {
    const next = applyCropHandle(full, window, 'e', -1000, 0, 20);
    expect(next.w).toBe(20);
    expect(next.x).toBe(0);
  });
});

describe('panFull', () => {
  it('shifts the bitmap under a fixed window', () => {
    const full = r(-100, -100, 600, 600);
    const window = r(0, 0, 400, 400);
    const next = panFull(full, window, 30, -20);
    expect(next.x).toBe(-70);
    expect(next.y).toBe(-120); // window 0..400 stays within bitmap -120..480
  });

  it('clamps so the window never leaves the bitmap', () => {
    const full = r(0, 0, 500, 500);
    const window = r(0, 0, 400, 400);
    // pushing the bitmap right would expose its left edge inside the window
    const next = panFull(full, window, 1000, 0);
    expect(next.x).toBe(0);
  });
});

describe('normalizeCrop', () => {
  it('collapses a near-identity crop to undefined', () => {
    expect(normalizeCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(
      normalizeCrop({ x: 1e-6, y: 0, w: 1 - 1e-6, h: 1 }),
    ).toBeUndefined();
  });

  it('keeps and clamps a real crop', () => {
    const c = normalizeCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(c).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  });

  it('clamps a width that overflows past 1', () => {
    const c = normalizeCrop({ x: 0.8, y: 0, w: 0.5, h: 1 });
    expect(c!.x).toBe(0.8);
    expect(c!.w).toBeCloseTo(0.2);
  });
});

describe('resetFrameForUncrop', () => {
  it('returns the full-bitmap rect so proportions restore', () => {
    const frame = r(100, 100, 200, 200);
    const crop: Crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    expect(resetFrameForUncrop(frame, crop)).toEqual(cropToFull(frame, crop));
  });
});
