import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import { MAX_RECENT_COLORS } from '../../src/model/presentation';

describe('MemSlidesStore.pushRecentColor', () => {
  it('defaults Meta.recentColors to undefined', () => {
    const store = new MemSlidesStore();
    expect(store.read().meta.recentColors).toBeUndefined();
  });

  it('records a color as the first recent', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.pushRecentColor('#ff0000'));
    expect(store.read().meta.recentColors).toEqual(['#ff0000']);
  });

  it('keeps most-recent-first order and de-dupes', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.pushRecentColor('#ff0000'));
    store.batch(() => store.pushRecentColor('#00ff00'));
    store.batch(() => store.pushRecentColor('#ff0000'));
    expect(store.read().meta.recentColors).toEqual(['#ff0000', '#00ff00']);
  });

  it(`caps at MAX_RECENT_COLORS (${MAX_RECENT_COLORS})`, () => {
    const store = new MemSlidesStore();
    for (let i = 0; i < MAX_RECENT_COLORS + 4; i++) {
      const hex = `#0000${i.toString(16).padStart(2, '0')}`;
      store.batch(() => store.pushRecentColor(hex));
    }
    expect(store.read().meta.recentColors).toHaveLength(MAX_RECENT_COLORS);
  });
});
