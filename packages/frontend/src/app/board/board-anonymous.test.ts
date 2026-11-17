import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { YorkieBoardRoot } from '@/types/board-document';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc } from './__testkit__';

describe('YorkieBoardStore anonymous mode', () => {
  it('is off on a board that never set it', () => {
    expect(new YorkieBoardStore(makeYorkieBoardDoc()).isAnonymous()).toBe(false);
  });

  it('is off on a viewer root with no meta at all', () => {
    const doc = new yorkie.Document<YorkieBoardRoot>(`test-board-${Math.random()}`);
    expect(new YorkieBoardStore(doc).isAnonymous()).toBe(false);
  });

  it('turns on and off in one undoable batch, dropping the field when off', () => {
    const doc = makeYorkieBoardDoc();
    const store = new YorkieBoardStore(doc);
    store.batch(() => store.setAnonymous(true));
    expect(store.isAnonymous()).toBe(true);
    expect(doc.getRoot().meta.anonymous).toBe(true);

    store.batch(() => store.setAnonymous(false));
    expect(store.isAnonymous()).toBe(false);
    expect(JSON.parse(doc.toJSON()).meta.anonymous).toBeUndefined();

    store.undo();
    expect(store.isAnonymous()).toBe(true);
  });

  it('requires a batch', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    expect(() => store.setAnonymous(true)).toThrow(/batch/);
  });
});
