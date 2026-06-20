import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '../../../src/app/slides/yorkie-slides-store.ts';
import type { SlideAnimation } from '@wafflebase/slides';

function makeDoc(): Document<YorkieSlidesRoot> {
  const doc = new yorkie.Document<YorkieSlidesRoot>(
    `test-anim-${Date.now()}-${Math.random()}`,
  );
  ensureSlidesRoot(doc);
  return doc;
}

function makeStore(): { store: YorkieSlidesStore; slideId: string } {
  const doc = makeDoc();
  const store = new YorkieSlidesStore(doc);
  let slideId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
  });
  return { store, slideId };
}

function makeAnim(id: string, effect: string = 'fadeIn'): SlideAnimation {
  return {
    id,
    elementId: `el-${id}`,
    category: 'entrance',
    effect: effect as SlideAnimation['effect'],
    start: 'onClick',
    durationMs: 500,
  };
}

describe('YorkieSlidesStore — addAnimation', () => {
  it('adds two animations and returns their ids in order', () => {
    const { store, slideId } = makeStore();
    let a1Id = '';
    let a2Id = '';
    store.batch(() => {
      a1Id = store.addAnimation(slideId, makeAnim('a1'));
      a2Id = store.addAnimation(slideId, makeAnim('a2'));
    });
    expect(a1Id).toBe('a1');
    expect(a2Id).toBe('a2');
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.animations?.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('creates the animations array on first add', () => {
    const { store, slideId } = makeStore();
    // Before any animation
    const before = store.read().slides.find((s) => s.id === slideId)!;
    expect(before.animations).toBeUndefined();

    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
    });
    const after = store.read().slides.find((s) => s.id === slideId)!;
    expect(after.animations).toBeDefined();
    expect(after.animations!.length).toBe(1);
  });
});

describe('YorkieSlidesStore — reorderAnimation', () => {
  it('moves a2 to the front (index 0)', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
      store.addAnimation(slideId, makeAnim('a2'));
    });
    store.batch(() => {
      store.reorderAnimation(slideId, 'a2', 0);
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.animations?.map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('is a no-op for a missing animId', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
    });
    store.batch(() => {
      store.reorderAnimation(slideId, 'nonexistent', 0);
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.animations?.map((a) => a.id)).toEqual(['a1']);
  });

  it('clamps toIndex beyond the array length', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
      store.addAnimation(slideId, makeAnim('a2'));
    });
    // toIndex=99 → clamped to length (end)
    store.batch(() => {
      store.reorderAnimation(slideId, 'a1', 99);
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.animations?.map((a) => a.id)).toEqual(['a2', 'a1']);
  });
});

describe('YorkieSlidesStore — updateAnimation', () => {
  it('patches scalar fields (effect → zoomIn)', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1', 'fadeIn'));
    });
    store.batch(() => {
      store.updateAnimation(slideId, 'a1', { effect: 'zoomIn' });
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const a = slide.animations?.find((x) => x.id === 'a1');
    expect(a?.effect).toBe('zoomIn');
  });

  it('does NOT change the id even if id is in the patch', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
    });
    store.batch(() => {
      // Passing id in patch must be silently ignored
      store.updateAnimation(slideId, 'a1', { id: 'x', effect: 'spin' } as never);
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const a = slide.animations?.find((x) => x.id === 'a1');
    expect(a?.id).toBe('a1');
    expect(a?.effect).toBe('spin');
  });

  it('throws when animId is not on the slide', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
    });
    expect(() => {
      store.batch(() => {
        store.updateAnimation(slideId, 'nonexistent', { effect: 'fadeIn' });
      });
    }).toThrow(/animation 'nonexistent' not on slide/);
  });
});

describe('YorkieSlidesStore — removeAnimation', () => {
  it('removes an animation and leaves the rest', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
      store.addAnimation(slideId, makeAnim('a2'));
    });
    store.batch(() => {
      store.removeAnimation(slideId, 'a2');
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.animations?.map((a) => a.id)).toEqual(['a1']);
  });

  it('deletes the animations field when the last animation is removed', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
    });
    store.batch(() => {
      store.removeAnimation(slideId, 'a1');
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.animations).toBeUndefined();
  });

  it('is a no-op when there are no animations', () => {
    const { store, slideId } = makeStore();
    expect(() => {
      store.batch(() => {
        store.removeAnimation(slideId, 'nonexistent');
      });
    }).not.toThrow();
  });
});

describe('YorkieSlidesStore — setSlideTransition', () => {
  it('sets a transition on the slide', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.setSlideTransition(slideId, { type: 'fade', durationMs: 400 });
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.transition).toEqual({ type: 'fade', durationMs: 400 });
  });

  it('clears the transition when called with undefined', () => {
    const { store, slideId } = makeStore();
    store.batch(() => {
      store.setSlideTransition(slideId, { type: 'fade', durationMs: 400 });
    });
    store.batch(() => {
      store.setSlideTransition(slideId, undefined);
    });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.transition).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeElement / removeElements — animation pruning
// ---------------------------------------------------------------------------

function makeShapeInYorkie(store: YorkieSlidesStore, slideId: string): string {
  let id = '';
  store.batch(() => {
    id = store.addElement(slideId, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    });
  });
  return id;
}

describe('YorkieSlidesStore — removeElement prunes animations', () => {
  it('removes the animations entry when the targeted element is deleted', () => {
    const { store, slideId } = makeStore();
    const elemId = makeShapeInYorkie(store, slideId);
    store.batch(() => store.addAnimation(slideId, { ...makeAnim('a1'), elementId: elemId }));
    // Verify animation is present.
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations,
    ).toHaveLength(1);
    store.batch(() => store.removeElement(slideId, elemId));
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations,
    ).toBeUndefined();
  });

  it('leaves unrelated animations intact after removeElement', () => {
    const { store, slideId } = makeStore();
    const e1 = makeShapeInYorkie(store, slideId);
    const e2 = makeShapeInYorkie(store, slideId);
    store.batch(() => {
      store.addAnimation(slideId, { ...makeAnim('a1'), elementId: e1 });
      store.addAnimation(slideId, { ...makeAnim('a2'), elementId: e2 });
    });
    store.batch(() => store.removeElement(slideId, e1));
    const anims = store.read().slides.find((s) => s.id === slideId)!.animations;
    expect(anims).toHaveLength(1);
    expect(anims![0].elementId).toBe(e2);
  });

  it('removeElements prunes animations for all removed elements', () => {
    const { store, slideId } = makeStore();
    const e1 = makeShapeInYorkie(store, slideId);
    const e2 = makeShapeInYorkie(store, slideId);
    store.batch(() => {
      store.addAnimation(slideId, { ...makeAnim('a1'), elementId: e1 });
      store.addAnimation(slideId, { ...makeAnim('a2'), elementId: e2 });
    });
    store.batch(() => store.removeElements(slideId, [e1, e2]));
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations,
    ).toBeUndefined();
  });

  it('removeElement prunes animations targeting group-nested children', () => {
    const { store, slideId } = makeStore();
    let groupId = '';
    let childId = '';
    store.batch(() => {
      childId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      const s2 = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 80, y: 80, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      ({ groupId } = store.group(slideId, [childId, s2]));
      store.addAnimation(slideId, { ...makeAnim('a-child'), elementId: childId });
    });
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations,
    ).toHaveLength(1);
    store.batch(() => store.removeElement(slideId, groupId));
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations,
    ).toBeUndefined();
  });
});

describe('YorkieSlidesStore — full animation sequence', () => {
  it('add → reorder → update → remove in sequence', () => {
    const { store, slideId } = makeStore();

    // Add two animations
    store.batch(() => {
      store.addAnimation(slideId, makeAnim('a1'));
      store.addAnimation(slideId, makeAnim('a2'));
    });
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations?.map((a) => a.id),
    ).toEqual(['a1', 'a2']);

    // Reorder a2 to front
    store.batch(() => store.reorderAnimation(slideId, 'a2', 0));
    expect(
      store.read().slides.find((s) => s.id === slideId)!.animations?.map((a) => a.id),
    ).toEqual(['a2', 'a1']);

    // Update a1's effect to zoomIn
    store.batch(() => store.updateAnimation(slideId, 'a1', { effect: 'zoomIn' }));
    const afterUpdate = store.read().slides.find((s) => s.id === slideId)!.animations!;
    expect(afterUpdate.find((a) => a.id === 'a1')?.effect).toBe('zoomIn');

    // Remove a2 → only a1 remains
    store.batch(() => store.removeAnimation(slideId, 'a2'));
    const afterRemove = store.read().slides.find((s) => s.id === slideId)!.animations!;
    expect(afterRemove.map((a) => a.id)).toEqual(['a1']);

    // Set transition then clear
    store.batch(() =>
      store.setSlideTransition(slideId, { type: 'fade', durationMs: 400 }),
    );
    expect(
      store.read().slides.find((s) => s.id === slideId)!.transition,
    ).toEqual({ type: 'fade', durationMs: 400 });

    store.batch(() => store.setSlideTransition(slideId, undefined));
    expect(
      store.read().slides.find((s) => s.id === slideId)!.transition,
    ).toBeUndefined();
  });
});
