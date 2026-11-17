import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeShapeInit, makeYorkieBoardDoc } from './__testkit__';

describe('YorkieBoardStore timer', () => {
  it('reads undefined on a board that never ran a timer', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    expect(store.readTimer()).toBeUndefined();
  });

  it('writes the timer into the document and notifies listeners', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    let notified = 0;
    store.onChange(() => notified++);
    store.writeTimer({ endsAt: 5000, pausedRemaining: null, durationMs: 60_000 });
    expect(store.readTimer()).toEqual({ endsAt: 5000, pausedRemaining: null, durationMs: 60_000 });
    expect(notified).toBe(1);
  });

  it('keeps timer changes out of the undo stack', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    store.batch(() => {
      store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
    });
    store.writeTimer({ endsAt: 5000, pausedRemaining: null, durationMs: 60_000 });
    store.writeTimer({ endsAt: null, pausedRemaining: 1000, durationMs: 60_000 });
    // Undo reverts the sticky, not the timer.
    store.undo();
    expect(store.read().slides[0].elements).toHaveLength(0);
    expect(store.readTimer()?.pausedRemaining).toBe(1000);
    expect(store.canUndo()).toBe(false);
  });

  it('refuses to write inside a batch', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    expect(() =>
      store.batch(() => {
        store.writeTimer({ endsAt: null, pausedRemaining: null, durationMs: 60_000 });
      }),
    ).toThrow(/batch/);
  });
});
