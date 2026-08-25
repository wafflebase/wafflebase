import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The hook reads the ambient `DocumentProvider`. Mocking `@yorkie-js/react` is
 * the seam that lets these tests drive connection + queue state directly,
 * without a real attach (which cannot run in jsdom).
 */
let mockCtx: { doc: FakeDoc | undefined; connection: string };

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => mockCtx,
}));

import { useSyncStatus } from '@/components/sync-status/use-sync-status';

type DocEvent = { type: string; value: unknown };

interface FakeDoc {
  hasLocalChanges: () => boolean;
  subscribe: (type: string, cb: (e: DocEvent) => void) => () => void;
  /** Test control: set what the change queue reports. */
  setQueued: (v: boolean) => void;
  /** Test control: fire a document event of the given type. */
  emit: (type: string, value: unknown) => void;
  /** How many times the hook has read the queue. */
  reads: () => number;
}

function fakeDoc(): FakeDoc {
  let queued = false;
  let reads = 0;
  const handlers = new Map<string, Array<(e: DocEvent) => void>>();
  return {
    hasLocalChanges: () => {
      reads++;
      return queued;
    },
    subscribe: (type, cb) => {
      const list = handlers.get(type) ?? [];
      list.push(cb);
      handlers.set(type, list);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== cb));
    },
    setQueued: (v) => {
      queued = v;
    },
    emit: (type, value) => {
      for (const h of handlers.get(type) ?? []) h({ type, value });
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
  it('reports saved when connected with an empty queue', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    const { result } = renderHook(() => useSyncStatus());

    expect(result.current.state).toBe('saved');
  });

  it('reports not-saved when disconnected with a queued change', () => {
    const doc = fakeDoc();
    doc.setQueued(true);
    mockCtx = { doc, connection: 'disconnected' };

    const { result } = renderHook(() => useSyncStatus());

    expect(result.current.state).toBe('not-saved');
  });

  it('does not poll the queue while connected and saved', () => {
    // A healthy document must cost nothing on a timer. This is the guard
    // against a 1s re-render loop running for every open editor.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    renderHook(() => useSyncStatus());
    const before = doc.reads();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(doc.reads()).toBe(before);
  });

  it('polls the queue while disconnected', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderHook(() => useSyncStatus());
    const before = doc.reads();
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(doc.reads()).toBeGreaterThan(before);
  });

  it('leaves not-saved once the queue drains after reconnecting', () => {
    const doc = fakeDoc();
    doc.setQueued(true);
    mockCtx = { doc, connection: 'disconnected' };
    const { result, rerender } = renderHook(() => useSyncStatus());
    expect(result.current.state).toBe('not-saved');

    mockCtx = { doc, connection: 'connected' };
    rerender();
    act(() => {
      doc.setQueued(false);
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.state).toBe('saved');
  });

  it('reports not-saved when a push is rejected while still connected', () => {
    const doc = fakeDoc();
    doc.setQueued(true);
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());
    expect(result.current.state).toBe('saving');

    act(() => {
      doc.emit('sync', 'sync-failed');
    });

    expect(result.current.state).toBe('not-saved');
  });

  it('clears a past failure once a sync succeeds', () => {
    const doc = fakeDoc();
    doc.setQueued(true);
    mockCtx = { doc, connection: 'connected' };
    const { result } = renderHook(() => useSyncStatus());

    act(() => {
      doc.emit('sync', 'sync-failed');
    });
    expect(result.current.state).toBe('not-saved');

    act(() => {
      doc.emit('sync', 'synced');
    });

    expect(result.current.state).toBe('saving');
  });

  it('does not re-render on a poll tick that changes nothing', () => {
    const doc = fakeDoc();
    doc.setQueued(true);
    mockCtx = { doc, connection: 'disconnected' };
    let renders = 0;
    renderHook(() => {
      renders++;
      return useSyncStatus();
    });
    const before = renders;

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(renders).toBe(before);
  });

  it('stamps pendingSince when the queue fills and clears it when it drains', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { result } = renderHook(() => useSyncStatus());
    expect(result.current.pendingSince).toBeNull();

    act(() => {
      doc.setQueued(true);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.pendingSince).toBeInstanceOf(Date);

    act(() => {
      doc.setQueued(false);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.pendingSince).toBeNull();
  });

  it('reports saved when there is no document yet', () => {
    mockCtx = { doc: undefined, connection: 'disconnected' };

    const { result } = renderHook(() => useSyncStatus());

    expect(result.current.state).toBe('saved');
  });
});
