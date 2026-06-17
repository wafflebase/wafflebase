import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '../../../src/app/slides/yorkie-slides-store.ts';

function makeStore(): YorkieSlidesStore {
  const doc: Document<YorkieSlidesRoot> = new yorkie.Document<YorkieSlidesRoot>(
    `test-${Date.now()}-${Math.random()}`,
  );
  ensureSlidesRoot(doc);
  return new YorkieSlidesStore(doc);
}

describe('YorkieSlidesStore.pushRecentColor', () => {
  it('persists a recent color through read()', () => {
    const store = makeStore();
    store.batch(() => store.pushRecentColor('#ff0000'));
    expect(store.read().meta.recentColors).toEqual(['#ff0000']);
  });

  it('accumulates most-recent-first and de-dupes across batches', () => {
    const store = makeStore();
    store.batch(() => store.pushRecentColor('#ff0000'));
    store.batch(() => store.pushRecentColor('#00ff00'));
    store.batch(() => store.pushRecentColor('#0000ff'));
    store.batch(() => store.pushRecentColor('#00ff00'));
    expect(store.read().meta.recentColors).toEqual([
      '#00ff00',
      '#0000ff',
      '#ff0000',
    ]);
  });
});
