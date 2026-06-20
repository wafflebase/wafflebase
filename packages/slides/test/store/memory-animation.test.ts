import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import type { SlideAnimation } from '../../src/model/presentation';

function newStore() {
  const store = new MemSlidesStore();
  let slideId!: string;
  store.batch(() => { slideId = store.addSlide('blank'); });
  return { store, slideId };
}

const anim = (id: string, elementId: string): SlideAnimation => ({
  id, elementId, category: 'entrance', effect: 'fadeIn',
  start: 'onClick', durationMs: 500,
});

function makeShape(store: MemSlidesStore, slideId: string) {
  return store.addElement(slideId, {
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { kind: 'rect' },
  });
}

describe('MemSlidesStore animation ops', () => {
  it('adds, reorders, updates and removes animations in order', () => {
    const { store, slideId } = newStore();
    store.batch(() => {
      store.addAnimation(slideId, anim('a1', 'e1'));
      store.addAnimation(slideId, anim('a2', 'e2'));
    });
    expect(store.read().slides[0].animations?.map((a) => a.id)).toEqual(['a1', 'a2']);

    store.batch(() => store.reorderAnimation(slideId, 'a2', 0));
    expect(store.read().slides[0].animations?.map((a) => a.id)).toEqual(['a2', 'a1']);

    store.batch(() => store.updateAnimation(slideId, 'a1', { effect: 'zoomIn' }));
    expect(store.read().slides[0].animations?.find((a) => a.id === 'a1')?.effect).toBe('zoomIn');

    store.batch(() => store.removeAnimation(slideId, 'a2'));
    expect(store.read().slides[0].animations?.map((a) => a.id)).toEqual(['a1']);
  });

  it('sets and clears a slide transition', () => {
    const { store, slideId } = newStore();
    store.batch(() => store.setSlideTransition(slideId, { type: 'fade', durationMs: 400 }));
    expect(store.read().slides[0].transition?.type).toBe('fade');
    store.batch(() => store.setSlideTransition(slideId, undefined));
    expect(store.read().slides[0].transition).toBeUndefined();
  });

  it('removeElement prunes animations targeting the removed element', () => {
    const { store, slideId } = newStore();
    let elemId!: string;
    store.batch(() => {
      elemId = makeShape(store, slideId);
      store.addAnimation(slideId, anim('a1', elemId));
    });
    expect(store.read().slides[0].animations).toHaveLength(1);
    store.batch(() => store.removeElement(slideId, elemId));
    expect(store.read().slides[0].animations).toBeUndefined();
  });

  it('removeElement prunes animations for a group and its nested children', () => {
    const { store, slideId } = newStore();
    let groupId!: string;
    let childId!: string;
    store.batch(() => {
      const a = makeShape(store, slideId);
      const b = makeShape(store, slideId);
      ({ groupId } = store.group(slideId, [a, b]));
      // childId is the id of element 'a' — now nested inside the group
      childId = a;
    });
    // Add an animation targeting the group-nested child.
    store.batch(() => store.addAnimation(slideId, anim('a-child', childId)));
    expect(store.read().slides[0].animations).toHaveLength(1);
    // Removing the group should also prune the child's animation.
    store.batch(() => store.removeElement(slideId, groupId));
    expect(store.read().slides[0].animations).toBeUndefined();
  });

  it('removeElements prunes animations for multiple removed elements', () => {
    const { store, slideId } = newStore();
    let e1!: string;
    let e2!: string;
    store.batch(() => {
      e1 = makeShape(store, slideId);
      e2 = makeShape(store, slideId);
      store.addAnimation(slideId, anim('a1', e1));
      store.addAnimation(slideId, anim('a2', e2));
    });
    expect(store.read().slides[0].animations).toHaveLength(2);
    store.batch(() => store.removeElements(slideId, [e1, e2]));
    expect(store.read().slides[0].animations).toBeUndefined();
  });

  it('removeElement leaves unrelated animations intact', () => {
    const { store, slideId } = newStore();
    let e1!: string;
    let e2!: string;
    store.batch(() => {
      e1 = makeShape(store, slideId);
      e2 = makeShape(store, slideId);
      store.addAnimation(slideId, anim('a1', e1));
      store.addAnimation(slideId, anim('a2', e2));
    });
    store.batch(() => store.removeElement(slideId, e1));
    const anims = store.read().slides[0].animations;
    expect(anims).toHaveLength(1);
    expect(anims![0].id).toBe('a2');
  });

  it('guards animation id immutability in updateAnimation', () => {
    const { store, slideId } = newStore();
    store.batch(() => {
      store.addAnimation(slideId, anim('a1', 'e1'));
    });

    // Attempt to change the id in the patch
    store.batch(() => {
      store.updateAnimation(slideId, 'a1', { id: 'hacked', effect: 'zoomIn' });
    });

    // Assert the animation is still found by id 'a1'
    const animation = store.read().slides[0].animations?.find((a) => a.id === 'a1');
    expect(animation).toBeDefined();
    expect(animation?.id).toBe('a1');
    // Assert the effect was patched but the id was not
    expect(animation?.effect).toBe('zoomIn');
  });
});
