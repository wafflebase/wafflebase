import { describe, it, expect } from 'vitest';
import type { Crop } from '../../src/model/element';
import {
  cropToFull,
  windowToCrop,
  applyCropHandle,
  panFull,
  normalizeCrop,
  effectiveCrop,
  rotateVec,
  frameToLocalWindow,
  windowToFrame,
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

describe('rotation helpers', () => {
  it('rotateVec rotates by the given cos/sin', () => {
    // 90°: cos=0, sin=1 → (1,0) -> (0,1)
    const v = rotateVec(1, 0, 0, 1);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it('frameToLocalWindow centres the window on the origin', () => {
    expect(frameToLocalWindow({ w: 400, h: 300 })).toEqual(
      r(-200, -150, 400, 300),
    );
  });

  it('windowToFrame reduces to the world frame when unrotated', () => {
    // Original frame (200,200,400,300): centre (400,350), local window
    // centred at origin → windowToFrame must recover the frame.
    const center = { x: 400, y: 350 };
    const win = frameToLocalWindow({ w: 400, h: 300 });
    expect(windowToFrame(win, center, 1, 0)).toEqual(r(200, 200, 400, 300));
  });

  it('windowToFrame round-trips a rotated, trimmed window', () => {
    // A rotated session: centre C0, 90° rotation. Trim the local window
    // and confirm the recovered frame, rotated about its own centre,
    // places the window centre back where the local centre maps to.
    const center = { x: 500, y: 500 };
    const cos = 0;
    const sin = 1; // 90°
    const win = r(-100, -150, 200, 200); // off-centre local window
    const frame = windowToFrame(win, center, cos, sin);
    // The frame centre in world must equal C0 + R(θ)·(local window centre).
    const lc = { x: win.x + win.w / 2, y: win.y + win.h / 2 }; // (0,-50)
    const wc = rotateVec(lc.x, lc.y, cos, sin); // (50, 0)
    expect(frame.x + frame.w / 2).toBeCloseTo(center.x + wc.x); // 550
    expect(frame.y + frame.h / 2).toBeCloseTo(center.y + wc.y); // 500
    expect(frame.w).toBe(200);
    expect(frame.h).toBe(200);
  });
});
