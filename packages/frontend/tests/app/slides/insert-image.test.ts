import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MemSlidesStore } from '@wafflebase/slides';
import { insertImageOnSlide } from '@/app/slides/insert-image.ts';

describe('insertImageOnSlide', () => {
  it('uploads then adds an image element centered on the slide', async () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });

    const file = new File(['fake-bytes'], 'a.png', { type: 'image/png' });
    const upload = mock.fn(async () => ({ url: 'https://cdn/test/a.png', w: 200, h: 100 }));

    const elementId = await insertImageOnSlide({ store, slideId, file, upload });

    assert.equal(upload.mock.calls.length, 1);
    assert.equal(upload.mock.calls[0].arguments[0], file);

    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    assert.ok(slide, 'slide must exist');

    const el = slide!.elements.find((e) => e.id === elementId);
    assert.ok(el, 'element must exist');
    assert.equal(el!.type, 'image');

    if (el!.type === 'image') {
      assert.equal(el.data.src, 'https://cdn/test/a.png');
      // Centered: x = (1920 - 200) / 2 = 860, y = (1080 - 100) / 2 = 490
      assert.ok(Math.abs(el.frame.x - (1920 - 200) / 2) < 0.001, `expected x≈860, got ${el.frame.x}`);
      assert.ok(Math.abs(el.frame.y - (1080 - 100) / 2) < 0.001, `expected y≈490, got ${el.frame.y}`);
      assert.equal(el.frame.w, 200);
      assert.equal(el.frame.h, 100);
      assert.equal(el.frame.rotation, 0);
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
    const upload = mock.fn(async () => { throw new Error('upload failed'); });

    await assert.rejects(
      () => insertImageOnSlide({ store, slideId, file, upload }),
      /upload failed/,
    );

    const afterElements = store.read().slides.find((s) => s.id === slideId)!.elements.length;
    assert.equal(afterElements, initialElements, 'store must not be mutated when upload fails');
  });
});
