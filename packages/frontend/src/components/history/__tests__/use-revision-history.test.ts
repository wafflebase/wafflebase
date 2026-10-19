import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRevisionHistory } from '../use-revision-history';

const listRevisions = vi.fn();
const createRevision = vi.fn();
const restoreRevision = vi.fn();
const getRevision = vi.fn();

vi.mock('@yorkie-js/react', () => ({
  useRevisions: () => ({ listRevisions, createRevision, getRevision, restoreRevision }),
}));

const rev = (id: string, label: string, iso: string, description = '') => ({
  id, label, description, snapshot: '', createdAt: new Date(iso),
});

const NEWEST = Date.parse('2026-09-02T10:00:00Z');

/**
 * `count` revisions starting at index `start`, newest first — the order
 * `listRevisions` returns. `r<n>` is always the same revision at the same
 * timestamp whichever offset it is read at, which is what makes a shifted
 * page testable.
 */
const page = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) =>
    rev(
      `r${start + i}`,
      `snapshot-${start + i}`,
      new Date(NEWEST - (start + i) * 60_000).toISOString(),
    ),
  );

const entryIds = (days: ReadonlyArray<{ entries: ReadonlyArray<{ id: string }> }>) =>
  days.flatMap((day) => day.entries.map((entry) => entry.id));

beforeEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue([rev('a', 'snapshot-1', '2026-09-02T10:00:00Z')]);
  createRevision.mockResolvedValue(rev('new', 'x', '2026-09-02T11:00:00Z'));
  restoreRevision.mockResolvedValue(undefined);
});

describe('useRevisionHistory', () => {
  it('loads and groups revisions when enabled', async () => {
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(result.current.days).toHaveLength(1));
    expect(result.current.days[0].entries[0].meta.kind).toBe('automatic');
  });

  it('fetches nothing while disabled', async () => {
    renderHook(() => useRevisionHistory({ enabled: false, userId: 42 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(listRevisions).not.toHaveBeenCalled();
  });

  it('names the current version with our metadata, then refreshes', async () => {
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(() => result.current.nameCurrentVersion('Launch copy'));
    expect(createRevision).toHaveBeenCalledWith(
      'Launch copy',
      '{"v":1,"by":42,"kind":"named"}',
    );
    expect(listRevisions).toHaveBeenCalledTimes(2);
  });

  // The safety revision is what makes restore non-destructive. It must exist
  // before the restore runs, not after.
  it('creates a safety revision before restoring', async () => {
    const order: string[] = [];
    createRevision.mockImplementation(async () => {
      order.push('create');
      return rev('safety', 'Before restore', '2026-09-02T11:00:00Z');
    });
    restoreRevision.mockImplementation(async () => { order.push('restore'); });

    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(() => result.current.restore('a'));

    expect(order).toEqual(['create', 'restore']);
    expect(createRevision).toHaveBeenCalledWith(
      'Before restore',
      '{"v":1,"by":42,"kind":"safety"}',
    );
  });

  it('does not restore when the safety revision fails', async () => {
    createRevision.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(result.current.restore('a')).rejects.toThrow('offline');
    });
    expect(restoreRevision).not.toHaveBeenCalled();
  });

  it('surfaces a load failure instead of rendering an empty timeline', async () => {
    listRevisions.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(result.current.error?.message).toBe('denied'));
    expect(result.current.days).toEqual([]);
  });

  it('keeps the previously loaded timeline after a later refresh fails', async () => {
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(result.current.days).toHaveLength(1));
    expect(result.current.error).toBe(null);

    // Make the next refresh fail
    listRevisions.mockRejectedValue(new Error('network error'));
    await act(() => result.current.refresh());

    // Timeline should still be there, error should be set
    expect(result.current.days).toHaveLength(1);
    expect(result.current.error?.message).toBe('network error');
  });

  // Nothing serializes `refresh` calls: the mount load and the refresh
  // `nameCurrentVersion` triggers can be in flight at once. If the older one
  // resolves last it used to overwrite the newer timeline, and the version
  // just named disappeared from the panel.
  it('ignores a stale list response that resolves after a newer one', async () => {
    let resolveFirst!: (revisions: unknown[]) => void;
    listRevisions
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(async () => [
        rev('newer', 'snapshot-2', '2026-09-02T12:00:00Z'),
      ]);

    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));

    // Started second, resolves first.
    await act(() => result.current.refresh());
    expect(result.current.days[0].entries[0].id).toBe('newer');

    await act(async () => {
      resolveFirst([rev('older', 'snapshot-1', '2026-09-02T10:00:00Z')]);
    });
    expect(result.current.days[0].entries[0].id).toBe('newer');
  });

  // `listRevisions` reports neither a total nor a "more exist" flag, so the
  // hook asks for one entry more than it shows and reads its presence as the
  // signal. The probe entry itself must never reach the timeline.
  it('asks for one more than a page and drops the probe entry', async () => {
    listRevisions.mockResolvedValue(page(0, 51));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    expect(listRevisions).toHaveBeenCalledWith({ pageSize: 51, offset: 0 });
    expect(entryIds(result.current.days)).toHaveLength(50);
    expect(entryIds(result.current.days)).not.toContain('r50');
  });

  it('reports no more pages when the first one is short', async () => {
    listRevisions.mockResolvedValue(page(0, 3));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(entryIds(result.current.days)).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);
  });

  it('appends the next page at the loaded offset', async () => {
    listRevisions
      .mockResolvedValueOnce(page(0, 51))
      .mockResolvedValueOnce(page(50, 10));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(() => result.current.loadMore());
    expect(listRevisions).toHaveBeenLastCalledWith({
      pageSize: 51,
      offset: 50,
    });
    expect(entryIds(result.current.days)).toHaveLength(60);
    expect(entryIds(result.current.days)).toContain('r59');
    expect(result.current.hasMore).toBe(false);
  });

  // A revision created between two page loads shifts every later offset by
  // one, so the boundary entry comes back a second time. Without the dedupe
  // the timeline shows it twice — and React warns on the duplicate key.
  it('drops entries a shifted offset returned twice', async () => {
    listRevisions
      .mockResolvedValueOnce(page(0, 51))
      // The shift: this page starts one entry earlier than it should.
      .mockResolvedValueOnce(page(49, 5));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(() => result.current.loadMore());
    const ids = entryIds(result.current.days);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(54);
  });

  // The offset describes the list the request started from. A refresh resets
  // the timeline to its first page, so an append computed against the old
  // list would duplicate or skip entries.
  it('ignores a page that a refresh superseded', async () => {
    let resolveLoadMore!: (revisions: unknown[]) => void;
    listRevisions
      .mockResolvedValueOnce(page(0, 51))
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveLoadMore = resolve; }),
      )
      .mockResolvedValueOnce(page(0, 2));

    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); });
    await act(() => result.current.refresh());
    expect(entryIds(result.current.days)).toHaveLength(2);

    await act(async () => {
      resolveLoadMore(page(50, 10));
      await pending;
    });
    expect(entryIds(result.current.days)).toHaveLength(2);
  });

  it('refuses a second load while one is in flight', async () => {
    listRevisions
      .mockResolvedValueOnce(page(0, 51))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => { void result.current.loadMore(); });
    await act(() => result.current.loadMore());
    expect(listRevisions).toHaveBeenCalledTimes(2);
  });

  // `error` hides the whole timeline, and the pages already loaded are still
  // good — so a failed append is the caller's to report, not the list's.
  it('rejects a failed load without emptying the timeline', async () => {
    listRevisions
      .mockResolvedValueOnce(page(0, 51))
      .mockRejectedValueOnce(new Error('denied'));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42 }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(async () => {
      await expect(result.current.loadMore()).rejects.toThrow('denied');
    });
    expect(entryIds(result.current.days)).toHaveLength(50);
    expect(result.current.error).toBe(null);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('notifies the editor after a restore so it can drop its undo stack', async () => {
    const onRestored = vi.fn();
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42, onRestored }),
    );
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(() => result.current.restore('a'));
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  // The preview overlay creates a second, `enabled: false` instance purely
  // for `restore` — nothing reads its `days`, so refreshing it is a round
  // trip whose result is dropped.
  it('does not re-list after a restore on a disabled instance', async () => {
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: false, userId: 42 }),
    );
    await act(() => result.current.restore('a'));
    expect(restoreRevision).toHaveBeenCalledWith('a');
    expect(listRevisions).not.toHaveBeenCalled();
  });

  it('does not notify when the restore failed', async () => {
    const onRestored = vi.fn();
    restoreRevision.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() =>
      useRevisionHistory({ enabled: true, userId: 42, onRestored }),
    );
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(result.current.restore('a')).rejects.toThrow('denied');
    });
    expect(onRestored).not.toHaveBeenCalled();
  });
});
