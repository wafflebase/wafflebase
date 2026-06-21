import { describe, it, expect, vi } from 'vitest';
import { MemSlidesStore, SLIDE_HEIGHT, SLIDE_WIDTH } from '@wafflebase/slides';
import {
  computeImageFrame,
  insertImageOnSlide,
} from '@/app/slides/insert-image.ts';

describe('computeImageFrame', () => {
  it('uses natural size 1:1 for images within the 80% cap', () => {
    const frame = computeImageFrame(200, 100);
    expect(frame.w).toBe(200);
    expect(frame.h).toBe(100);
    expect(frame.x).toBe((SLIDE_WIDTH - 200) / 2);
    expect(frame.y).toBe((SLIDE_HEIGHT - 100) / 2);
    expect(frame.rotation).toBe(0);
  });

  it('caps oversized landscape images at 80% of the slide width', () => {
    const frame = computeImageFrame(3840, 1080);
    expect(frame.w).toBe(SLIDE_WIDTH * 0.8);
    expect(frame.h).toBeCloseTo(SLIDE_WIDTH * 0.8 * (1080 / 3840));
    expect(frame.x).toBeCloseTo((SLIDE_WIDTH - frame.w) / 2);
    expect(frame.y).toBeCloseTo((SLIDE_HEIGHT - frame.h) / 2);
  });

  it('caps tall portrait images at 80% of the slide height', () => {
    const frame = computeImageFrame(800, 4000);
    expect(frame.h).toBe(SLIDE_HEIGHT * 0.8);
    expect(frame.w).toBeCloseTo(SLIDE_HEIGHT * 0.8 * (800 / 4000));
  });

  it('falls back to a centred 0×0 frame when a dimension is missing', () => {
    const frame = computeImageFrame(0, 0);
    expect(frame.w).toBe(0);
    expect(frame.h).toBe(0);
    expect(frame.x).toBe(SLIDE_WIDTH / 2);
    expect(frame.y).toBe(SLIDE_HEIGHT / 2);
  });

  it('never produces a NaN / non-finite frame for bad dimensions', () => {
    for (const [w, h] of [
      [Infinity, 1080],
      [800, Infinity],
      [NaN, 600],
      [-100, 200],
    ] as const) {
      const frame = computeImageFrame(w, h);
      for (const v of [frame.x, frame.y, frame.w, frame.h]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('insertImageOnSlide', () => {
  it('uploads then adds an image element centered on the slide', async () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });

    const file = new File(['fake-bytes'], 'a.png', { type: 'image/png' });
    const upload = vi.fn(async () => ({ url: 'https://cdn/test/a.png', w: 200, h: 100 }));

    const elementId = await insertImageOnSlide({ store, slideId, file, upload });

    expect(upload.mock.calls.length).toBe(1);
    expect(upload.mock.calls[0][0]).toBe(file);

    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    expect(slide, 'slide must exist').toBeTruthy();

    const el = slide!.elements.find((e) => e.id === elementId);
    expect(el, 'element must exist').toBeTruthy();
    expect(el!.type).toBe('image');

    if (el!.type === 'image') {
      expect(el.data.src).toBe('https://cdn/test/a.png');
      // Centered: x = (1920 - 200) / 2 = 860, y = (1080 - 100) / 2 = 490
      expect(
        Math.abs(el.frame.x - (1920 - 200) / 2) < 0.001,
        `expected x≈860, got ${el.frame.x}`
      ).toBeTruthy();
      expect(
        Math.abs(el.frame.y - (1080 - 100) / 2) < 0.001,
        `expected y≈490, got ${el.frame.y}`
      ).toBeTruthy();
      expect(el.frame.w).toBe(200);
      expect(el.frame.h).toBe(100);
      expect(el.frame.rotation).toBe(0);
    }
  });

  it('does nothing to the store if upload rejects', async () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });

    const initialElements = store.read().slides.find((s) => s.id === slideId)!.elements.length;

    const file = new File(['bytes'], 'bad.png', { type: 'image/png' });
    const upload = vi.fn(async () => { throw new Error('upload failed'); });

    await expect(insertImageOnSlide({ store, slideId, file, upload })).rejects.toThrow(/upload failed/);

    const afterElements = store.read().slides.find((s) => s.id === slideId)!.elements.length;
    expect(afterElements, 'store must not be mutated when upload fails').toBe(initialElements);
  });
});
