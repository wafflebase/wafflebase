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
