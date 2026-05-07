import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '../../../src/app/slides/yorkie-slides-store.ts';

function makeDoc(): Document<YorkieSlidesRoot> {
  const doc = new yorkie.Document<YorkieSlidesRoot>(
    `test-${Date.now()}-${Math.random()}`,
  );
  ensureSlidesRoot(doc);
  return doc;
}

describe('YorkieSlidesStore — read', () => {
  it('returns a deep snapshot of the Yorkie root', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const out = store.read();
    assert.equal(out.meta.title, 'Untitled presentation');
    assert.deepEqual(out.slides, []);
    assert.ok(out.layouts.length > 0);
  });
});

describe('YorkieSlidesStore — slide ops', () => {
  it('addSlide pushes onto the array and returns the new id', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => {
      id = store.addSlide('blank');
    });
    assert.deepEqual(
      store.read().slides.map((s) => s.id),
      [id],
    );
    assert.equal(typeof id, 'string');
  });

  it('addSlide("title-body") seeds two text placeholders', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => {
      id = store.addSlide('title-body');
    });
    const slide = store.read().slides.find((s) => s.id === id)!;
    assert.equal(slide.elements.length, 2);
  });

  it('removeSlide drops the slide', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => {
      id = store.addSlide('blank');
    });
    store.batch(() => store.removeSlide(id));
    assert.deepEqual(store.read().slides, []);
  });

  it('moveSlide reorders', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 3; i++) ids.push(store.addSlide('blank'));
    });
    store.batch(() => store.moveSlide(ids[2], 0));
    assert.deepEqual(
      store.read().slides.map((s) => s.id),
      [ids[2], ids[0], ids[1]],
    );
  });
});

describe('YorkieSlidesStore — element ops', () => {
  it('addElement / updateElementFrame / removeElement', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let elId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      elId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    store.batch(() => store.updateElementFrame(slideId, elId, { x: 100 }));
    assert.equal(store.read().slides[0].elements[0].frame.x, 100);
    store.batch(() => store.removeElement(slideId, elId));
    assert.deepEqual(store.read().slides[0].elements, []);
  });
});

describe('YorkieSlidesStore — undo/redo (snapshot-based)', () => {
  it('one batch = one undo entry', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    store.batch(() => {
      store.addSlide('blank');
      store.addSlide('blank');
    });
    assert.equal(store.read().slides.length, 2);
    store.undo();
    assert.deepEqual(store.read().slides, []);
    store.redo();
    assert.equal(store.read().slides.length, 2);
  });

  it('throws if a mutation is called outside a batch', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    assert.throws(() => store.addSlide('blank'), /must be wrapped in batch/);
  });
});

describe('YorkieSlidesStore — remote-change subscription', () => {
  it('does not fire onRemoteChange for local mutations', () => {
    // For a complete test we'd need two clients sharing a docKey via
    // the real Yorkie server (Phase 4b). For Phase 4a we just verify
    // that the subscriber wiring exists and a local change does NOT
    // fire it (only remote changes should).
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let fired = false;
    store.onRemoteChange = () => {
      fired = true;
    };
    store.batch(() => store.addSlide('blank'));
    assert.equal(fired, false);
  });
});
