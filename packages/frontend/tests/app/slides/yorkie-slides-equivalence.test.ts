import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import {
  MemSlidesStore,
  type SlidesDocument,
  type SlidesStore,
} from '@wafflebase/slides';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '@/app/slides/yorkie-slides-store.ts';
import type { YorkieSlidesRoot } from '@/types/slides-document.ts';

function makeYorkie(): YorkieSlidesStore {
  const doc = new (yorkie as unknown as {
    Document: new (key: string) => yorkie.Document<YorkieSlidesRoot>;
  }).Document(`equiv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  ensureSlidesRoot(doc);
  return new YorkieSlidesStore(doc);
}

/** Apply the same op sequence to both stores and return their final snapshots. */
function runBoth(seq: (s: SlidesStore) => void): { mem: SlidesDocument; yo: SlidesDocument } {
  const mem = new MemSlidesStore();
  const yo = makeYorkie();
  seq(mem);
  seq(yo);
  return { mem: mem.read(), yo: yo.read() };
}

/**
 * Compare two snapshots structurally. Element / slide ids are
 * generated independently per store, so we strip them before comparing
 * to focus on the structural shape: order, frames, types, layout ids.
 */
function stripIds(doc: SlidesDocument): unknown {
  return {
    meta: doc.meta,
    layouts: doc.layouts.map((l) => ({ id: l.id, name: l.name, placeholderCount: l.placeholders.length })),
    slides: doc.slides.map((s) => ({
      layoutId: s.layoutId,
      background: s.background,
      notesLength: s.notes.length,
      elements: s.elements.map((e) => ({
        type: e.type,
        frame: e.frame,
      })),
    })),
  };
}

describe('YorkieSlidesStore ≡ MemSlidesStore (single client, local doc)', () => {
  it('add 3 slides, reorder, remove one', () => {
    const { mem, yo } = runBoth((store) => {
      const ids: string[] = [];
      store.batch(() => {
        for (let i = 0; i < 3; i++) ids.push(store.addSlide(i === 1 ? 'title' : 'blank'));
      });
      store.batch(() => store.moveSlide(ids[2], 0));
      store.batch(() => store.removeSlide(ids[1]));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides.length, 2);
  });

  it('add element, updateElementFrame, reorderElement, remove', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      store.batch(() => { slideId = store.addSlide('blank'); });
      store.batch(() => {
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 10, y: 10, w: 100, h: 60, rotation: 0 },
          data: { kind: 'rect', fill: '#abc' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 20, y: 20, w: 100, h: 60, rotation: 0 },
          data: { kind: 'ellipse', fill: '#def' },
        });
      });
      store.batch(() => store.updateElementFrame(slideId, aId, { x: 200 }));
      store.batch(() => store.reorderElement(slideId, aId, 1));
      store.batch(() => store.removeElement(slideId, bId));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides[0].elements.length, 1);
    assert.equal(yo.slides[0].elements[0].frame.x, 200);
  });

  it('applyLayout preserves user-edited elements', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      store.batch(() => { slideId = store.addSlide('blank'); });
      store.batch(() => {
        store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#abc' },
        });
      });
      store.batch(() => store.applyLayout(slideId, 'title-body'));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    // Title-body adds 2 placeholders; user shape preserved → 3 total.
    assert.equal(yo.slides[0].elements.length, 3);
  });

  it('batch / undo / redo round-trip', () => {
    const { mem, yo } = runBoth((store) => {
      store.batch(() => { store.addSlide('blank'); store.addSlide('blank'); });
      store.undo();
      store.redo();
      store.batch(() => store.addSlide('title'));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides.length, 3);
  });

  it('updateSlideBackground stores a deep clone (mem vs yorkie)', () => {
    const { mem, yo } = runBoth((store) => {
      let id = '';
      store.batch(() => { id = store.addSlide('blank'); });
      // Legacy callers may still hand us a string fill; migrateDocument
      // wraps it into the v0.5 ThemeColor shape on read.
      const bg = { fill: '#ff0000' } as unknown as Parameters<typeof store.updateSlideBackground>[1];
      store.batch(() => store.updateSlideBackground(id, bg));
      (bg as { fill: string }).fill = '#00ff00'; // mutating the input must not change either store
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.deepEqual(yo.slides[0].background.fill, { kind: 'srgb', value: '#ff0000' });
  });

  it('withTextElement replace-mode round-trip', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let elId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        elId = store.addElement(slideId, {
          type: 'text',
          frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
          data: { blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} }] as never },
        });
      });
      store.batch(() => {
        store.withTextElement(slideId, elId, () => [
          { id: 'b2', type: 'paragraph', inlines: [{ text: 'bye', style: {} }], style: {} } as never,
        ]);
      });
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
  });
});
