/**
 * Logic tests for ImageControls.
 *
 * The component is TSX and cannot be rendered in the Node strip-types runner.
 * We test the data-access predicates and store-write paths directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemSlidesStore } from '@wafflebase/slides';

function setupStore(opts: { withCrop?: boolean; withAlt?: string } = {}) {
  const store = new MemSlidesStore();
  let slideId = '';
  let elementId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
    elementId = store.addElement(slideId, {
      type: 'image',
      frame: { x: 10, y: 20, w: 100, h: 80, rotation: 0 },
      data: {
        src: 'https://cdn/img.png',
        crop: opts.withCrop ? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } : undefined,
        alt: opts.withAlt,
      },
    });
  });
  return { store, slideId, elementId };
}

function readImage(store: MemSlidesStore, slideId: string, elementId: string) {
  const slide = store.read().slides.find((s) => s.id === slideId)!;
  const el = slide.elements.find((e) => e.id === elementId);
  assert.ok(el && el.type === 'image');
  return el;
}

describe('ImageControls — hasCrop derivation', () => {
  it('hasCrop is false when no crop is set', () => {
    const { store, slideId, elementId } = setupStore({ withCrop: false });
    const el = readImage(store, slideId, elementId);
    assert.equal(!!el.data.crop, false);
  });

  it('hasCrop is true when a crop rectangle is stored', () => {
    const { store, slideId, elementId } = setupStore({ withCrop: true });
    const el = readImage(store, slideId, elementId);
    assert.equal(!!el.data.crop, true);
  });
});

describe('ImageControls — onResetCrop', () => {
  it('clears the crop field via updateElementData', () => {
    const { store, slideId, elementId } = setupStore({ withCrop: true });
    // Simulate what onResetCrop does
    store.batch(() =>
      store.updateElementData(slideId, elementId, { crop: undefined }),
    );
    const el = readImage(store, slideId, elementId);
    assert.equal(el.data.crop, undefined);
  });
});

describe('ImageControls — onSaveAlt', () => {
  it('writes alt text via updateElementData', () => {
    const { store, slideId, elementId } = setupStore();
    store.batch(() =>
      store.updateElementData(slideId, elementId, { alt: 'A chart showing sales' }),
    );
    const el = readImage(store, slideId, elementId);
    assert.equal(el.data.alt, 'A chart showing sales');
  });

  it('can overwrite existing alt text', () => {
    const { store, slideId, elementId } = setupStore({ withAlt: 'old alt' });
    store.batch(() =>
      store.updateElementData(slideId, elementId, { alt: 'new alt' }),
    );
    const el = readImage(store, slideId, elementId);
    assert.equal(el.data.alt, 'new alt');
  });
});
