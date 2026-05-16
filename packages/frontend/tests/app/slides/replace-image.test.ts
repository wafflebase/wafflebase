import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
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
    const upload = mock.fn(async () => ({ url: 'https://cdn/new.png', w: 640, h: 480 }));

    await replaceImageOnSlide({ store, slideId, elementId, file, upload });

    assert.equal(upload.mock.calls.length, 1);
    assert.equal(upload.mock.calls[0].arguments[0], file);

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const el = slide.elements.find((e) => e.id === elementId);
    assert.ok(el, 'element must exist');
    assert.equal(el!.type, 'image');
    if (el!.type === 'image') {
      assert.equal(el.data.src, 'https://cdn/new.png');
      assert.equal(el.data.crop, undefined, 'crop must be cleared');
    }
  });

  it('preserves frame x/y/w/h/rotation after replace', async () => {
    const { store, slideId, elementId } = setupStore();
    const file = new File(['bytes'], 'new.png', { type: 'image/png' });
    const upload = mock.fn(async () => ({ url: 'https://cdn/new.png', w: 640, h: 480 }));

    await replaceImageOnSlide({ store, slideId, elementId, file, upload });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const el = slide.elements.find((e) => e.id === elementId)!;
    assert.equal(el.frame.x, 100);
    assert.equal(el.frame.y, 200);
    assert.equal(el.frame.w, 300);
    assert.equal(el.frame.h, 400);
    assert.ok(Math.abs(el.frame.rotation - 0.5) < 0.001);
  });

  it('propagates rejection and leaves store untouched when upload fails', async () => {
    const { store, slideId, elementId } = setupStore();
    const before = store.read().slides.find((s) => s.id === slideId)!.elements;
    const srcBefore = (before.find((e) => e.id === elementId) as { data: { src: string } } | undefined)?.data.src;

    const file = new File(['bytes'], 'bad.png', { type: 'image/png' });
    const upload = mock.fn(async () => { throw new Error('upload failed'); });

    await assert.rejects(
      () => replaceImageOnSlide({ store, slideId, elementId, file, upload }),
      /upload failed/,
    );

    const after = store.read().slides.find((s) => s.id === slideId)!.elements;
    const srcAfter = (after.find((e) => e.id === elementId) as { data: { src: string } } | undefined)?.data.src;
    assert.equal(srcAfter, srcBefore, 'src must be unchanged when upload fails');
  });
});
