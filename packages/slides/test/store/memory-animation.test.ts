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
});
