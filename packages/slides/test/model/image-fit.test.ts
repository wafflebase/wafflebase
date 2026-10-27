import { describe, it, expect } from 'vitest';
import { containRect, coverCrop } from '../../src/model/image-fit';

describe('coverCrop', () => {
  it('crops left/right equally when the bitmap is wider than the frame', () => {
    // 200x100 (AR 2) into a square frame → keep the middle half.
    expect(coverCrop(200, 100, 50, 50)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it('crops top/bottom equally when the bitmap is taller than the frame', () => {
    // 100x200 (AR 0.5) into a square frame → keep the middle half.
    expect(coverCrop(100, 200, 50, 50)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 });
  });

  it('keeps the whole bitmap when the aspect ratios match', () => {
    expect(coverCrop(160, 90, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('returns null for an unknown natural size', () => {
    expect(coverCrop(0, 100, 50, 50)).toBeNull();
  });
});

describe('containRect', () => {
  it('letterboxes and centres a bitmap scaled down to the frame', () => {
    // 100x80 into 50x50 → scale 0.5 → 50x40, 5px bands top and bottom.
    expect(containRect(100, 80, 50, 50)).toEqual({ x: 0, y: 5, w: 50, h: 40 });
  });

  it('never upscales: a small bitmap is centred at natural size', () => {
    expect(containRect(100, 80, 400, 400)).toEqual({ x: 150, y: 160, w: 100, h: 80 });
  });

  it('returns null for an unknown natural size', () => {
    expect(containRect(100, 0, 50, 50)).toBeNull();
  });
});
