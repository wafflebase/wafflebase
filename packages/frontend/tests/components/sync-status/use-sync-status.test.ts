import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The hook reads the ambient `DocumentProvider`. Mocking `@yorkie-js/react` is
 * the seam that lets these tests drive editing, presence and acknowledgement
 * directly, without a real attach (which cannot run in jsdom).
 */
let mockCtx: { doc: FakeDoc | undefined; connection: string };

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => mockCtx,
}));

import { useSyncStatus } from '@/components/sync-status/use-sync-status';

type DocEvent = { type: string; value: unknown };

interface FakeDoc {
  getCheckpoint: () => { getClientSeq: () => number };
  subscribe: (
    arg1: string | ((e: DocEvent) => void),
    arg2?: (e: DocEvent) => void,
  ) => () => void;
  emit: (type: string, value?: unknown) => void;
  /** Test control: the user edited the document. */
  type: () => void;
  /** Test control: the user moved a selection — presence only, no operation. */
  drag: () => void;
  /** Test control: the server accepted everything pushed so far. */
  ack: () => void;
  /** How many times the hook has asked about outstanding work. */
  reads: () => number;
}

const DEFAULT_STREAM = '__default__';

/**
 * Models the two facts about `Document.update()` that this feature turns on,
 * both read off `@yorkie-js/sdk`'s published bundle:
 *
 *   this.localChanges.push(change);   // EVERY change, presence-only included
 *   if (opInfos.length) { ...publish a 'local-change' event... }
 *
 * So a presence-only change — dragging a selection, moving a caret — makes
 * `hasLocalChanges()` true while emitting no `local-change` event at all. That
 * asymmetry is the whole reason this fake distinguishes `type()` from
 * `drag()`.
 */
function fakeDoc(): FakeDoc {
  let clientSeq = 0;
  let acked = 0;
  let reads = 0;
  const handlers = new Map<string, Array<(e: DocEvent) => void>>();
  const on = (key: string, cb: (e: DocEvent) => void) => {
    const list = handlers.get(key) ?? [];
    list.push(cb);
    handlers.set(key, list);
    return () => handlers.set(key, (handlers.get(key) ?? []).filter((h) => h !== cb));
  };
  const fire = (key: string, e: DocEvent) => {
    for (const h of handlers.get(key) ?? []) h(e);
  };
  return {
    getCheckpoint: () => ({
      getClientSeq: () => {
        reads++;
        return acked;
      },
    }),
    subscribe: (arg1, arg2) =>
      typeof arg1 === 'function' ? on(DEFAULT_STREAM, arg1) : on(arg1, arg2!),
    emit: (type, value) => {
      fire(type, { type, value });
      fire(DEFAULT_STREAM, { type, value });
    },
    type: () => {
      clientSeq++;
      fire(DEFAULT_STREAM, { type: 'local-change', value: { clientSeq } });
    },
    drag: () => {
      clientSeq++;
    },
    ack: () => {
      acked = clientSeq;
    },
    reads: () => reads,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSyncStatus', () => {
  it('reports saved on a document nobody has edited', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    const { result } = renderHook(() => useSyncStatus());

    expect(result.current.state).toBe('saved');
  });

  it('reports saving the moment the user types', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      doc.type();
    });

    expect(result.current.state).toBe('saving');
  });

  it('stays saved while the user only drags a selection', () => {
    // Dragging writes presence. Presence-only changes join the local change
    // queue — so `hasLocalChanges()` goes true — but carry no operation and
    // emit no `local-change`. Nothing of the user's document is at stake, and
    // reporting it made the chip toggle Saving/Saved on every drag in Sheets.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      for (let i = 0; i < 5; i++) {
        doc.drag();
        // The presence change is pushed like any other, so a sync event
        // follows it — which is the moment the old code sampled the queue and
        // mistook a moved selection for unsaved work.
        doc.emit('sync', 'synced');
        vi.advanceTimersByTime(400);
      }
    });

    expect(result.current.state).toBe('saved');
  });

  it('does not let a later drag hold up an edit that was already accepted', () => {
    // The residue of the same confusion: once the typing is acknowledged, a
    // presence change refilling the queue must not read as unfinished work.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      doc.type();
      doc.ack();
      doc.drag();
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.state).toBe('saved');
  });

  it('holds saving through a whole burst of typing', () => {
    // Each push is accepted almost immediately, so between keystrokes there is
    // genuinely nothing outstanding. The chip must not read that as done.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      for (let i = 0; i < 6; i++) {
        doc.type();
        doc.ack();
        doc.emit('sync', 'synced');
        vi.advanceTimersByTime(500);
      }
    });

    expect(result.current.state).toBe('saving');
  });

  it('settles to saved once typing stops and the edit is accepted', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());
    act(() => {
      doc.type();
    });
    expect(result.current.state).toBe('saving');

    act(() => {
      doc.ack();
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.state).toBe('saved');
  });

  it('never settles while an edit remains unaccepted, however long it waits', () => {
    // A quiet keyboard is not a flushed document.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      doc.type();
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.state).toBe('not-saved');
  });

  it('reports reconnecting when disconnected with nothing outstanding', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const { result } = renderHook(() => useSyncStatus());

    expect(result.current.state).toBe('reconnecting');
  });

  it('reports a stranded edit immediately, without waiting to settle', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result, rerender } = renderHook(() => useSyncStatus());

    act(() => {
      doc.type();
    });
    mockCtx = { doc, connection: 'disconnected' };
    act(() => {
      rerender();
    });

    expect(result.current.state).toBe('not-saved');
  });

  it('reports not-saved when a push is rejected while still connected', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());
    act(() => {
      doc.type();
    });
    expect(result.current.state).toBe('saving');

    act(() => {
      doc.emit('sync', 'sync-failed');
    });

    expect(result.current.state).toBe('not-saved');
  });

  it('clears a past failure once a sync succeeds', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());
    act(() => {
      doc.type();
      doc.emit('sync', 'sync-failed');
    });
    expect(result.current.state).toBe('not-saved');

    act(() => {
      doc.emit('sync', 'synced');
    });

    expect(result.current.state).toBe('saving');
  });

  it('asks nothing of the document while there is no outstanding work', () => {
    // A document nobody is editing must not cost a timer. This is the guard
    // against a background loop running for every open editor.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    renderHook(() => useSyncStatus());
    const before = doc.reads();
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(doc.reads()).toBe(before);
  });

  it('does not re-render while the state is unchanged', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    let renders = 0;
    renderHook(() => {
      renders++;
      return useSyncStatus();
    });
    act(() => {
      doc.type();
    });
    const before = renders;

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(renders).toBe(before);
  });

  it('stamps pendingSince when an edit starts and clears it when accepted', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());
    expect(result.current.pendingSince).toBeNull();

    act(() => {
      doc.type();
    });
    expect(result.current.pendingSince).toBeInstanceOf(Date);

    act(() => {
      doc.ack();
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.pendingSince).toBeNull();
  });

  it('starts over when the provider swaps in a different document', () => {
    // `DocumentProvider` keeps one store for its lifetime and replaces `doc`
    // in place rather than remounting its children. The replacement starts at
    // checkpoint 0, so a sequence carried over from the old document is
    // permanently ahead of it — the chip would stick on Saving… forever and
    // escalate to a false Not saved on any blip.
    const first = fakeDoc();
    mockCtx = { doc: first, connection: 'connected' };
    const { result, rerender } = renderHook(() => useSyncStatus());
    act(() => {
      first.type();
    });
    expect(result.current.state).toBe('saving');

    const second = fakeDoc();
    mockCtx = { doc: second, connection: 'connected' };
    act(() => {
      rerender();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.state).toBe('saved');
  });

  it('re-stamps pendingSince when a fresh edit follows an accepted one', () => {
    // Otherwise the tooltip reports an hour of writing as at risk when only
    // the last keystroke is.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      doc.type();
    });
    const first = result.current.pendingSince;
    expect(first).toBeInstanceOf(Date);

    act(() => {
      doc.ack();
      vi.advanceTimersByTime(1000);
      doc.type();
    });

    expect(result.current.pendingSince).not.toBe(first);
  });

  it('does not carry a failed pull into the next edit', () => {
    // A sync can fail with nothing of the user's outstanding — a pull that did
    // not land. Remembering that failure would make the *next* edit report as
    // rejected, arming the guard and the warning over a push that was never
    // even attempted.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      doc.emit('sync', 'sync-failed');
    });
    expect(result.current.state).toBe('saved');

    act(() => {
      doc.type();
    });

    expect(result.current.state).toBe('saving');
  });

  it('reports saved when there is no document yet', () => {
    mockCtx = { doc: undefined, connection: 'disconnected' };

    const { result } = renderHook(() => useSyncStatus());

    expect(result.current.state).toBe('saved');
  });
});
