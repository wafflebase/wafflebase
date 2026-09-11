import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import { getActiveTheme } from '@wafflebase/slides';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';
import type { Block } from '@wafflebase/docs';
import { MAX_FONT_SIZE, MAX_LINE_HEIGHT, MAX_LIST_LEVEL } from '@wafflebase/docs';
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
    expect(out.meta.title).toBe('Untitled presentation');
    expect(out.slides).toEqual([]);
    expect(out.layouts.length > 0).toBeTruthy();
  });
});

describe('ensureSlidesRoot — initial theme preference', () => {
  it('seeds default-light when no preference is provided', () => {
    const doc = new yorkie.Document<YorkieSlidesRoot>(
      `test-${Date.now()}-${Math.random()}`,
    );
    ensureSlidesRoot(doc);
    const root = doc.getRoot();
    expect(root.meta.themeId).toBe('default-light');
    expect(root.themes.map((t) => t.id)).toEqual(['default-light']);
  });

  it('seeds default-dark when initialThemePreference is "dark"', () => {
    const doc = new yorkie.Document<YorkieSlidesRoot>(
      `test-${Date.now()}-${Math.random()}`,
    );
    ensureSlidesRoot(doc, { initialThemePreference: 'dark' });
    const root = doc.getRoot();
    expect(root.meta.themeId).toBe('default-dark');
    expect(root.themes.map((t) => t.id)).toEqual(['default-dark']);
  });

  it('does NOT change theme on a doc whose meta already exists', () => {
    // Migration safety: an existing deck that lacks a `themes` array
    // (pre-v0.5 shape) but already has `meta` must keep its existing
    // look. A current dark-mode viewer mounting that deck should NOT
    // repaint it to default-dark.
    const doc = new yorkie.Document<YorkieSlidesRoot>(
      `test-${Date.now()}-${Math.random()}`,
    );
    doc.update((r) => {
      const rootAny = r as unknown as {
        meta: { title: string; themeId: string; masterId: string };
        slides: unknown[];
        layouts: unknown[];
      };
      rootAny.meta = {
        title: 'Pre-existing deck',
        themeId: 'default-light',
        masterId: 'default',
      };
      rootAny.slides = [];
      rootAny.layouts = [];
    });
    ensureSlidesRoot(doc, { initialThemePreference: 'dark' });
    const root = doc.getRoot();
    expect(root.meta.themeId).toBe('default-light');
    expect(root.themes.map((t) => t.id)).toEqual(['default-light']);
  });
});

/**
 * A customized deck whose `meta` pins ids its own `themes` / `masters` arrays
 * do not carry — the shape a removed or renamed custom theme leaves behind. A
 * writable mount repairs it in the CRDT; a read-only one must reconcile it in
 * memory instead. Both read-only and writable cases below build *this* deck,
 * so the pair contrasts on identical input.
 */
function seedCustomizedDeck(): Document<YorkieSlidesRoot> {
  const doc = new yorkie.Document<YorkieSlidesRoot>(
    `test-${Date.now()}-${Math.random()}`,
  );
  doc.update((r) => {
    const rootAny = r as unknown as {
      meta: { title: string; themeId: string; masterId: string };
      slides: unknown[];
      layouts: unknown[];
      themes: unknown[];
      masters: unknown[];
    };
    rootAny.meta = {
      title: 'Customized deck',
      themeId: 'a-theme-that-was-removed',
      masterId: 'a-master-that-was-removed',
    };
    rootAny.slides = [];
    rootAny.layouts = [];
    rootAny.themes = [{ id: 'coral', name: 'Coral', colors: {}, fonts: {} }];
    rootAny.masters = [{ id: 'custom', name: 'Custom', placeholders: [] }];
  });
  return doc;
}

describe('ensureSlidesRoot — read-only mounts', () => {
  it('writes nothing at all when readOnly', () => {
    const doc = new yorkie.Document<YorkieSlidesRoot>(
      `test-${Date.now()}-${Math.random()}`,
    );
    ensureSlidesRoot(doc, { readOnly: true });
    // Not "seeds a lighter shape" — nothing. Both branches are
    // `doc.update()`s on the CRDT root, and a share-link viewer's write is
    // refused at the next PushPull by the Yorkie auth webhook, which wedges
    // that viewer's own sync.
    expect(doc.getRoot().meta).toBeUndefined();
    expect(doc.getRoot().slides).toBeUndefined();
    expect(doc.toJSON()).toBe('{}');
  });

  it('skips the pre-v0.5 backfill when readOnly, and reads it in memory', () => {
    const doc = new yorkie.Document<YorkieSlidesRoot>(
      `test-${Date.now()}-${Math.random()}`,
    );
    // An unmigrated deck: `meta`/`slides`/`layouts` present, but no
    // `themes`/`masters`/`guides`. This is the shape that made a viewer's
    // mount write.
    doc.update((r) => {
      const rootAny = r as unknown as {
        meta: { title: string; themeId: string; masterId: string };
        slides: unknown[];
        layouts: unknown[];
      };
      rootAny.meta = {
        title: 'Pre-existing deck',
        themeId: 'default-light',
        masterId: 'default',
      };
      rootAny.slides = [];
      rootAny.layouts = [];
    });

    ensureSlidesRoot(doc, { readOnly: true });
    expect(doc.getRoot().themes).toBeUndefined();
    expect(doc.getRoot().masters).toBeUndefined();

    // Nothing downstream needs the write: `read()` runs the same backfill in
    // memory, so the viewer still renders the deck.
    const out = new YorkieSlidesStore(doc).read();
    expect(out.themes.length > 0).toBeTruthy();
    expect(out.masters.length > 0).toBeTruthy();
    expect(out.themes.some((t) => t.id === out.meta.themeId)).toBe(true);
  });

  it('reconciles a stale meta.themeId in memory so a viewer can render', () => {
    // A viewer mount skips the CRDT repair, so the reconciliation has to
    // happen on the read path or `getActiveTheme` throws and the share route
    // renders nothing.
    const doc = seedCustomizedDeck();

    ensureSlidesRoot(doc, { readOnly: true });
    // Untouched: the viewer wrote nothing.
    expect(doc.getRoot().meta.themeId).toBe('a-theme-that-was-removed');

    const out = new YorkieSlidesStore(doc).read();
    expect(out.meta.themeId).toBe('coral');
    expect(out.meta.masterId).toBe('custom');
    expect(() => getActiveTheme(out)).not.toThrow();
  });

  it('still backfills a writable mount of the same deck', () => {
    // The other half of the contrast: identical input, writable mount. The
    // repair the viewer above only got in memory is persisted here — and the
    // deck's own themes are kept, not repainted with a built-in.
    const doc = seedCustomizedDeck();
    ensureSlidesRoot(doc);
    expect(doc.getRoot().meta.themeId).toBe('coral');
    expect(doc.getRoot().meta.masterId).toBe('custom');
    expect(doc.getRoot().themes.map((t) => t.id)).toEqual(['coral']);
    expect(doc.getRoot().masters.map((m) => m.id)).toEqual(['custom']);
    // The pre-ruler backfill runs on the same pass.
    expect(doc.getRoot().guides.length).toBe(0);
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
    expect(store.read().slides.map((s) => s.id)).toEqual([id]);
    expect(typeof id).toBe('string');
  });

  it('addSlide("title-body") seeds two text placeholders', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => {
      id = store.addSlide('title-body');
    });
    const slide = store.read().slides.find((s) => s.id === id)!;
    expect(slide.elements.length).toBe(2);
  });

  it('seeded title-body placeholders read with an empty body', () => {
    // Phase B (P1.4) gates 1-click text-edit entry on the empty-
    // placeholder predicate, which delegates to `isElementEmpty` →
    // `isBlocksEmpty`. The dev bug "click just selects, never enters
    // edit" would surface here if the Yorkie read path subtly
    // diverged from `MemSlidesStore` (e.g. a non-empty inline survived
    // through `yorkieToPlain`).
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => { id = store.addSlide('title-body'); });
    const slide = store.read().slides.find((s) => s.id === id)!;
    for (const el of slide.elements) {
      if (el.type !== 'text' || !el.placeholderRef) continue;
      const label = `placeholderRef.type=${el.placeholderRef.type}`;
      const allInlinesEmpty = el.data.blocks.every(
        (b) => b.inlines.every((inline) => inline.text === ''),
      );
      expect(allInlinesEmpty, `${label}: inlines empty`).toBe(true);
    }
  });

  it('removeSlide drops the slide', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => {
      id = store.addSlide('blank');
    });
    store.batch(() => store.removeSlide(id));
    expect(store.read().slides).toEqual([]);
  });

  it('moveSlide reorders', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 3; i++) ids.push(store.addSlide('blank'));
    });
    store.batch(() => store.moveSlide(ids[2], 0));
    expect(store.read().slides.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('moveSlide reorders to a later index', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 4; i++) ids.push(store.addSlide('blank'));
    });
    // Move slide 0 down to index 2 (remove-then-insert semantics).
    store.batch(() => store.moveSlide(ids[0], 2));
    expect(store.read().slides.map((s) => s.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
      ids[3],
    ]);
  });

  it('moveSlides moves a block, preserving relative order', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 4; i++) ids.push(store.addSlide('blank'));
    });
    // Move slides 0 and 3 (in array order) to index 1 among the rest.
    store.batch(() => store.moveSlides([ids[3], ids[0]], 1));
    expect(store.read().slides.map((s) => s.id)).toEqual([
      ids[1],
      ids[0],
      ids[3],
      ids[2],
    ]);
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
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
    store.batch(() => store.removeElement(slideId, elId));
    expect(store.read().slides[0].elements).toEqual([]);
  });
});

describe('YorkieSlidesStore — undo/redo (Yorkie-native doc.history)', () => {
  it('one batch = one undo entry', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    store.batch(() => {
      store.addSlide('blank');
      store.addSlide('blank');
    });
    expect(store.read().slides.length).toBe(2);
    store.undo();
    expect(store.read().slides).toEqual([]);
    store.redo();
    expect(store.read().slides.length).toBe(2);
  });

  it('groups a multi-element drag into a single undo unit', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    const ids: string[] = [];
    store.batch(() => {
      slideId = store.addSlide('blank');
      for (let i = 0; i < 3; i++) {
        ids.push(
          store.addElement(slideId, {
            type: 'shape',
            frame: { x: i * 10, y: 0, w: 50, h: 50, rotation: 0 },
            data: { kind: 'rect' },
          }),
        );
      }
    });
    // One batch moving all three elements — mirrors dragging a 3-element
    // selection. With native undo this must collapse to ONE undo unit.
    store.batch(() => {
      for (const id of ids) {
        const cur = store.read().slides[0].elements.find((e) => e.id === id)!;
        store.updateElementFrame(slideId, id, { x: cur.frame.x + 100 });
      }
    });
    const movedXs = store
      .read()
      .slides[0].elements.map((e) => e.frame.x);
    expect(movedXs).toEqual([100, 110, 120]);

    store.undo(); // reverts all three in one step
    const revertedXs = store
      .read()
      .slides[0].elements.map((e) => e.frame.x);
    expect(revertedXs).toEqual([0, 10, 20]);

    store.redo();
    expect(store.read().slides[0].elements.map((e) => e.frame.x)).toEqual([
      100, 110, 120,
    ]);
  });

  it('cannot undo past the seeded initial state (undo floor)', () => {
    const doc = makeDoc();
    // Seed a deck BEFORE constructing the store so the seed becomes the
    // initial state the floor protects (mirrors how a real deck opens with
    // one slide before the editor store is built).
    const seed = new YorkieSlidesStore(doc);
    seed.batch(() => seed.addSlide('blank'));

    const store = new YorkieSlidesStore(doc);
    expect(store.read().slides.length).toBe(1);
    // Nothing has been edited through THIS store yet, and the floor was
    // captured at construction, so undo is unavailable.
    expect(store.canUndo()).toBe(false);
    store.undo(); // no-op
    expect(store.read().slides.length).toBe(1);

    // One real edit becomes undoable; undoing it returns to the floor, not
    // below it.
    store.batch(() => store.addSlide('blank'));
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.read().slides.length).toBe(1);
    expect(store.canUndo()).toBe(false);
    store.undo(); // still cannot drop below the seed
    expect(store.read().slides.length).toBe(1);
  });

  it('markUndoBaseline protects a post-construction deck seed', () => {
    // Mirrors slides-view.tsx: construct the store on an empty deck, seed
    // the first slide, then re-base the floor so the seed isn't undoable.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    expect(store.read().slides.length).toBe(0);
    store.batch(() => store.addSlide('blank'));
    store.markUndoBaseline();

    expect(store.read().slides.length).toBe(1);
    expect(store.canUndo()).toBe(false);
    store.undo(); // no-op — can't undo the seed
    expect(store.read().slides.length).toBe(1);

    // A real edit after the baseline is undoable, back to the seed.
    store.batch(() => store.addSlide('blank'));
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.read().slides.length).toBe(1);
    expect(store.canUndo()).toBe(false);
  });

  it('updatePresence inside a batch does not open a nested update', () => {
    // A selection change can fire synchronously while a batch's doc.update
    // is still open. updatePresence must fold into the ambient presence,
    // not open a nested doc.update (which Yorkie forbids). The batch must
    // still commit as a single undo unit.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    expect(() => {
      store.batch(() => {
        slideId = store.addSlide('blank');
        store.updatePresence({ activeSlideId: slideId });
      });
    }).not.toThrow();
    expect(store.read().slides.length).toBe(1);
    store.undo();
    expect(store.read().slides.length).toBe(0);
  });

  it('reverses an array move (moveSlide) on undo/redo', () => {
    // Native undo must reverse the Yorkie array move primitives, not just
    // object `set`. moveSlide uses moveFront/moveAfterByIndex.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 3; i++) ids.push(store.addSlide('blank'));
    });
    const order = () => store.read().slides.map((s) => s.id);
    expect(order()).toEqual([ids[0], ids[1], ids[2]]);

    store.batch(() => store.moveSlide(ids[2], 0));
    expect(order()).toEqual([ids[2], ids[0], ids[1]]);

    store.undo();
    expect(order()).toEqual([ids[0], ids[1], ids[2]]);
    store.redo();
    expect(order()).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('reverses an object-key delete (setSlideTransition) on undo/redo', () => {
    // Removing a transition deletes the `transition` key. Native undo must
    // restore the deleted key (object-key delete must be reversible).
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    store.batch(() =>
      store.setSlideTransition(slideId, { type: 'fade', durationMs: 500 }),
    );
    expect(store.read().slides[0].transition).toEqual({
      type: 'fade',
      durationMs: 500,
    });

    store.batch(() => store.setSlideTransition(slideId, undefined));
    expect(store.read().slides[0].transition).toBeUndefined();

    store.undo(); // restores the deleted transition
    expect(store.read().slides[0].transition).toEqual({
      type: 'fade',
      durationMs: 500,
    });
    store.redo(); // deletes it again
    expect(store.read().slides[0].transition).toBeUndefined();
  });

  it('read() mid-batch reflects prior same-batch mutations (bringToFront)', () => {
    // editor.ts bringToFront/sendToBack and keyboard reorder call
    // store.read() INSIDE store.batch() and depend on it reflecting the
    // reorderElement they just issued in the same batch. With one
    // doc.update held open for the whole batch, read() must see in-progress
    // mutations (and must not throw on toJSON of the live root, e.g. when
    // meta carries a recentColors primitive array).
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    const ids: string[] = [];
    store.batch(() => {
      slideId = store.addSlide('blank');
      for (let i = 0; i < 3; i++) {
        ids.push(
          store.addElement(slideId, {
            type: 'shape',
            frame: { x: i, y: 0, w: 10, h: 10, rotation: 0 },
            data: { kind: 'rect' },
          }),
        );
      }
    });
    store.batch(() => store.pushRecentColor('#abcdef')); // primitive array in meta

    // Bring ids[0] then ids[1] to the front, re-reading live order each step.
    expect(() => {
      store.batch(() => {
        for (const id of [ids[0], ids[1]]) {
          const live = store.read().slides.find((s) => s.id === slideId)!;
          store.reorderElement(slideId, id, live.elements.length - 1);
        }
      });
    }).not.toThrow();
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
  });

  it('throws if a mutation is called outside a batch', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    expect(() => store.addSlide('blank')).toThrow(/must be wrapped in batch/);
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
    expect(fired).toBe(false);
  });
});

describe('YorkieSlidesStore — group / ungroup', () => {
  it('group() wraps two elements into a group element', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let aId = '';
    let bId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'ellipse' },
      });
    });
    let groupId = '';
    store.batch(() => {
      const result = store.group(slideId, [aId, bId]);
      groupId = result.groupId;
      expect(result.excludedConnectorIds.length).toBe(0);
    });
    const slide = store.read().slides[0];
    expect(slide.elements.length).toBe(1);
    const group = slide.elements[0];
    expect(group.type).toBe('group');
    expect(group.id).toBe(groupId);
    expect((group as { data: { children: unknown[] } }).data.children.length).toBe(2);
  });

  it('ungroup() dissolves a group back to its parent array', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let aId = '';
    let bId = '';
    let groupId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'ellipse' },
      });
    });
    store.batch(() => {
      const result = store.group(slideId, [aId, bId]);
      groupId = result.groupId;
    });
    store.batch(() => {
      const childIds = store.ungroup(slideId, groupId);
      expect(childIds.length).toBe(2);
    });
    const slide = store.read().slides[0];
    expect(slide.elements.length).toBe(2);
    expect(slide.elements.every(e => e.type === 'shape')).toBeTruthy();
  });

  it('addElement(parentGroupId) appends to a group child array', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let aId = '';
    let bId = '';
    let groupId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'ellipse' },
      });
    });
    store.batch(() => {
      groupId = store.group(slideId, [aId, bId]).groupId;
    });
    store.batch(() => {
      store.addElement(slideId, {
        type: 'shape',
        frame: { x: 20, y: 20, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      }, groupId);
    });
    const slide = store.read().slides[0];
    expect(slide.elements.length).toBe(1); // still one group at root
    const group = slide.elements[0] as { data: { children: unknown[] } };
    expect(group.data.children.length).toBe(3); // now 3 children
  });

  it('removeElement on the last child of a group removes the group too', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let aId = '';
    let bId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'ellipse' },
      });
    });
    let groupId = '';
    store.batch(() => {
      groupId = store.group(slideId, [aId, bId]).groupId;
    });
    // Read back the actual child ids from the group (since group() renumbers frames/ids aren't changed
    // but the group element has its own id; children keep their ids).
    const groupEl = store.read().slides[0].elements[0] as {
      data: { children: Array<{ id: string }> };
    };
    const [childA, childB] = groupEl.data.children;
    store.batch(() => store.removeElement(slideId, childA.id));
    // One child remains, group still exists.
    expect(store.read().slides[0].elements.length).toBe(1);
    expect(store.read().slides[0].elements[0].type).toBe('group');
    store.batch(() => store.removeElement(slideId, childB.id));
    // Last child removed → group auto-pruned.
    expect(store.read().slides[0].elements).toEqual([]);
    expect(groupId.length > 0).toBeTruthy();
  });

  it('updateElementFrame on a group-nested element works', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let aId = '';
    let bId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'ellipse' },
      });
    });
    store.batch(() => {
      store.group(slideId, [aId, bId]);
    });
    // Get the child ids from the group.
    const groupEl = store.read().slides[0].elements[0] as {
      data: { children: Array<{ id: string; frame: { x: number } }> };
    };
    const childId = groupEl.data.children[0].id;
    // Update the frame of a nested element.
    store.batch(() => store.updateElementFrame(slideId, childId, { x: 99 }));
    const updatedGroupEl = store.read().slides[0].elements[0] as {
      data: { children: Array<{ id: string; frame: { x: number } }> };
    };
    const updated = updatedGroupEl.data.children.find(c => c.id === childId)!;
    expect(updated.frame.x).toBe(99);
  });
});

describe('YorkieSlidesStore — withShapeText', () => {
  // Inline test helpers — the docs Block schema is straightforward and
  // a one-line constructor is cheaper than importing a fixture util.
  type TestBlock = {
    id: string;
    type: 'paragraph';
    inlines: Array<{ text: string; style: Record<string, never> }>;
    style: Record<string, never>;
  };
  const paragraph = (text: string, id = 'p1'): TestBlock => ({
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  });

  function addShape(
    store: YorkieSlidesStore,
  ): { slideId: string; shapeId: string } {
    let slideId = '';
    let shapeId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      shapeId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb', value: '#abc' } },
      });
    });
    return { slideId, shapeId };
  }

  it('writes data.text on a shape that had none and round-trips through read()', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideId, shapeId } = addShape(store);
    store.batch(() => {
      store.withShapeText(slideId, shapeId, (blocks) => {
        // First entry: shape has no prior body, so the callback receives [].
        expect(blocks).toEqual([]);
        return [paragraph('Hello') as never];
      });
    });
    const el = store.read().slides[0].elements[0] as {
      data: { text?: { blocks: Array<{ inlines: Array<{ text: string }> }> } };
    };
    expect(el.data.text?.blocks[0].inlines[0].text).toBe('Hello');
  });

  it('preserves an empty body after the user clears prior text (no destructive delete)', () => {
    // Concurrency contract: once data.text exists, withShapeText only
    // writes the `blocks` field — it never deletes data.text. A peer
    // typing into the same shape during a blur must not have its
    // content wiped by a wholesale-field delete.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideId, shapeId } = addShape(store);
    store.batch(() => {
      store.withShapeText(slideId, shapeId, () => [paragraph('typed') as never]);
    });
    store.batch(() => {
      store.withShapeText(slideId, shapeId, () => [paragraph('') as never]);
    });
    const el = store.read().slides[0].elements[0] as {
      data: { text?: { blocks: Array<{ inlines: Array<{ text: string }> }> } };
    };
    expect(el.data.text).toBeDefined();
    expect(el.data.text!.blocks[0].inlines[0].text).toBe('');
  });

  it('is a no-op when entered without and exited without data.text (click-in-then-blur)', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideId, shapeId } = addShape(store);
    store.batch(() => {
      store.withShapeText(slideId, shapeId, () => [paragraph('') as never]);
    });
    const el = store.read().slides[0].elements[0] as {
      data: { text?: unknown };
    };
    expect(el.data.text).toBeUndefined();
  });

  it('throws on a non-shape element', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let textId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 40, rotation: 0 },
        data: { blocks: [] },
      });
    });
    expect(() =>
      store.batch(() =>
        store.withShapeText(slideId, textId, () => undefined),
      ),
    ).toThrow(/not a shape element/);
  });
});

describe('YorkieSlidesStore — the text-body numeric band', () => {
  // A slide text body is plain JSON on the Yorkie root: it passes through no
  // Tree attribute codec on the way out, unlike a docs body, so this store is
  // the only boundary standing between a peer's `doc.update` and
  // `computeLayout`. The v1 `PUT` bands the same values, but a modified
  // client editing the deck collaboratively never goes through it.
  const poisoned = () => [
    {
      id: 'p1',
      type: 'list-item',
      // Finite rather than `Infinity`: a non-finite number stored in the
      // CRDT does not survive `yorkieToPlain`'s `JSON.parse` at all. `1e9` is
      // the variant that *does* reach the layout engine — the million-page
      // allocation rather than the non-terminating loop.
      listLevel: 1e9,
      style: { lineHeight: 1e9 },
      inlines: [{ text: 'x', style: { fontSize: 1e9 } }],
    },
  ];

  /** Write `mutate` straight onto the root, as a hostile peer's sync would. */
  function withHostilePeer(
    doc: Document<YorkieSlidesRoot>,
    mutate: (slide: Record<string, unknown>) => void,
  ): void {
    doc.update((r) => {
      mutate((r as unknown as { slides: Record<string, unknown>[] }).slides[0]);
    });
  }

  function expectBanded(blocks: Block[]): void {
    expect(blocks[0].listLevel).toBe(MAX_LIST_LEVEL);
    expect(blocks[0].style.lineHeight).toBe(MAX_LINE_HEIGHT);
    expect(blocks[0].inlines[0].style.fontSize).toBe(MAX_FONT_SIZE);
  }

  it('bands a text element body a peer poisoned', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: { blocks: [] },
      });
    });
    withHostilePeer(doc, (slide) => {
      const els = slide.elements as Record<string, unknown>[];
      els[0].data = { blocks: poisoned() };
    });

    const el = store.read().slides[0].elements[0] as { data: { blocks: Block[] } };
    expectBanded(el.data.blocks);
  });

  it('bands shape text, table cell bodies and notes a peer poisoned', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    withHostilePeer(doc, (slide) => {
      const els = slide.elements as Record<string, unknown>[];
      els[0].data = { kind: 'rect', text: { blocks: poisoned() } };
      els.push({
        id: 'tbl',
        type: 'table',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: {
          rows: [{ cells: [{ body: { blocks: poisoned() }, style: {} }] }],
        },
      });
      slide.notes = poisoned();
    });

    const slide = store.read().slides[0];
    expectBanded(
      (slide.elements[0] as { data: { text: { blocks: Block[] } } }).data.text.blocks,
    );
    expectBanded(
      (slide.elements[1] as {
        data: { rows: { cells: { body: { blocks: Block[] } }[] }[] };
      }).data.rows[0].cells[0].body.blocks,
    );
    expectBanded(slide.notes);
  });

  it('hands the editor bridge a banded body, so an edit writes the repair back', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let elId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      elId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: { blocks: [] },
      });
    });
    withHostilePeer(doc, (slide) => {
      (slide.elements as Record<string, unknown>[])[0].data = {
        blocks: poisoned(),
      };
    });

    let seen: Block[] = [];
    store.batch(() => {
      store.withTextElement(slideId, elId, (blocks) => {
        seen = blocks;
      });
    });
    expectBanded(seen);
    const el = store.read().slides[0].elements[0] as { data: { blocks: Block[] } };
    expectBanded(el.data.blocks);
  });

  it('bands a layout placeholder spec a peer poisoned', () => {
    // A `PlaceholderSpec` is an `ElementInit`, so a text placeholder carries
    // the same codec-free `data.blocks` a slide element does — and
    // `seedPlaceholderBlocks` copies that typography into the real blocks a
    // layout change materializes.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    doc.update((r) => {
      const layouts = r.layouts as unknown as Record<string, unknown>[];
      layouts[0].placeholders = [
        {
          type: 'text',
          frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
          placeholder: { type: 'body' },
          data: { blocks: poisoned() },
        },
      ];
    });

    const spec = store.read().layouts[0].placeholders[0] as unknown as {
      data: { blocks: Block[] };
    };
    expectBanded(spec.data.blocks);
  });

  it('bands the master typography a peer poisoned', () => {
    // `Master.placeholderStyles` carries the same `fontSize` / `lineHeight`
    // pair, and `seedPlaceholderBlocks` copies it verbatim into a docs
    // `Block` — so an unbanded master reaches `computeLayout` by a route the
    // block bands never see. It is also multiplied into a canvas font for the
    // empty-placeholder hint.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    doc.update((r) => {
      const masters = r.masters as unknown as Record<string, unknown>[];
      masters[0].placeholderStyles = {
        title: {
          fontRole: 'heading',
          fontSize: 1e9,
          colorRole: 'text',
          align: 'left',
          lineHeight: 1e9,
        },
        body: {
          fontRole: 'body',
          fontSize: 1e9,
          colorRole: 'text',
          align: 'left',
          lineHeight: 1e9,
        },
      };
    });

    const styles = store.read().masters[0].placeholderStyles;
    for (const style of [styles.title, styles.body]) {
      expect(style.fontSize).toBe(MAX_FONT_SIZE);
      expect(style.lineHeight).toBe(MAX_LINE_HEIGHT);
    }
  });

  it('keeps a poisoned master out of the blocks a layout change seeds', () => {
    // `resolveMasterAndTheme` is the reader that actually feeds
    // `seedPlaceholderBlocks`: `addSlide` builds the slide's placeholder
    // elements from it, so an unbanded master here writes `fontSize: 1e9`
    // into a real block on the Yorkie root.
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    doc.update((r) => {
      const masters = r.masters as unknown as Record<string, unknown>[];
      masters[0].placeholderStyles = {
        title: {
          fontRole: 'heading',
          fontSize: 1e9,
          colorRole: 'text',
          align: 'left',
          lineHeight: 1e9,
        },
        body: {
          fontRole: 'body',
          fontSize: 1e9,
          colorRole: 'text',
          align: 'left',
          lineHeight: 1e9,
        },
      };
    });
    store.batch(() => store.addSlide('title-body'));

    // Asserted against the *stored* JSON, not `read()`: the read path bands
    // blocks on its way out, so it would hide a poisoned size that the seed
    // had already committed to the CRDT for every other reader of the deck.
    const stored = JSON.parse(doc.toJSON()) as {
      slides: { elements: { type: string; data: { blocks: Block[] } }[] }[];
    };
    const texts = stored.slides[0].elements.filter((e) => e.type === 'text');
    expect(texts.length).toBeGreaterThan(0);
    for (const el of texts) {
      expect(el.data.blocks[0].inlines[0].style.fontSize).toBe(MAX_FONT_SIZE);
      expect(el.data.blocks[0].style.lineHeight).toBe(MAX_LINE_HEIGHT);
    }
  });
});
