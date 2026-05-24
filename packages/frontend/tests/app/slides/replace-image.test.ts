import { describe, it, expect, vi } from 'vitest';
import { MemSlidesStore } from '@wafflebase/slides';
import { replaceImageOnSlide } from '@/app/slides/replace-image.ts';

describe('replaceImageOnSlide', () => {
  function setupStore() {
    const store = new MemSlidesStore();
    let slideId = '';
    let elementId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      elementId = store.addElement(slideId, {
        type: 'image',
        frame: { x: 100, y: 200, w: 300, h: 400, rotation: 0.5 },
        data: { src: 'https://cdn/old.png', crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
      });
    });
    return { store, slideId, elementId };
  }

  it('replaces src and clears crop on successful upload', async () => {
    const { store, slideId, elementId } = setupStore();
    const file = new File(['bytes'], 'new.png', { type: 'image/png' });
    const upload = vi.fn(async () => ({ url: 'https://cdn/new.png', w: 640, h: 480 }));

    await replaceImageOnSlide({ store, slideId, elementId, file, upload });

    expect(upload.mock.calls.length).toBe(1);
    expect(upload.mock.calls[0][0]).toBe(file);

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const el = slide.elements.find((e) => e.id === elementId);
    expect(el, 'element must exist').toBeTruthy();
    expect(el!.type).toBe('image');
    if (el!.type === 'image') {
      expect(el.data.src).toBe('https://cdn/new.png');
      expect(el.data.crop, 'crop must be cleared').toBe(undefined);
    }
  });

  it('preserves frame x/y/w/h/rotation after replace', async () => {
    const { store, slideId, elementId } = setupStore();
    const file = new File(['bytes'], 'new.png', { type: 'image/png' });
    const upload = vi.fn(async () => ({ url: 'https://cdn/new.png', w: 640, h: 480 }));

    await replaceImageOnSlide({ store, slideId, elementId, file, upload });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const el = slide.elements.find((e) => e.id === elementId)!;
    expect(el.frame.x).toBe(100);
    expect(el.frame.y).toBe(200);
    expect(el.frame.w).toBe(300);
    expect(el.frame.h).toBe(400);
    expect(Math.abs(el.frame.rotation - 0.5) < 0.001).toBeTruthy();
  });

  it('propagates rejection and leaves store untouched when upload fails', async () => {
    const { store, slideId, elementId } = setupStore();
    const before = store.read().slides.find((s) => s.id === slideId)!.elements;
    const srcBefore = (before.find((e) => e.id === elementId) as { data: { src: string } } | undefined)?.data.src;

    const file = new File(['bytes'], 'bad.png', { type: 'image/png' });
    const upload = vi.fn(async () => { throw new Error('upload failed'); });

    await expect(replaceImageOnSlide({ store, slideId, elementId, file, upload })).rejects.toThrow(/upload failed/);

    const after = store.read().slides.find((s) => s.id === slideId)!.elements;
    const srcAfter = (after.find((e) => e.id === elementId) as { data: { src: string } } | undefined)?.data.src;
    expect(srcAfter, 'src must be unchanged when upload fails').toBe(srcBefore);
  });
});
