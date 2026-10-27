import { describe, it, expect } from 'vitest';
import { containRect, coverCrop, fitCropSession } from '../../src/model/image-fit';
import { windowToCrop } from '../../src/model/image-crop';

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

describe('fitCropSession', () => {
  const frame = { x: -50, y: -50, w: 100, h: 100 };

  it("'cover' keeps the frame as the window over the centre-cropped bitmap", () => {
    const s = fitCropSession(frame, 'cover', 200, 100)!;
    expect(s.window).toEqual(frame);
    expect(s.full).toEqual({ x: -100, y: -50, w: 200, h: 100 });
    // Committing it unchanged writes exactly the crop the renderer paints.
    expect(windowToCrop(s.full, s.window)).toEqual(coverCrop(200, 100, 100, 100));
  });

  it("'contain' starts from the letterboxed rect showing the whole bitmap", () => {
    const s = fitCropSession(frame, 'contain', 200, 100)!;
    expect(s.window).toEqual({ x: -50, y: -25, w: 100, h: 50 });
    expect(s.full).toEqual(s.window);
  });

  it("is null when the stretch already matches the paint", () => {
    expect(fitCropSession(frame, undefined, 200, 100)).toBeNull();
    expect(fitCropSession(frame, 'fill', 200, 100)).toBeNull();
    expect(fitCropSession(frame, 'cover', 0, 0)).toBeNull();
    expect(fitCropSession(frame, 'contain', 0, 0)).toBeNull();
  });
});
