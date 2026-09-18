import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The housekeeping runtime is where four promises the rest of the feature
 * makes are actually kept, and every one of them happens when no editor is
 * mounted: logout's identity, the erase watcher, the thirty-day sweep, the
 * reconcile against what the server still lists, and the offer of work that
 * could not be saved. Nothing else runs any of them, so nothing else can fail
 * to.
 */

const rememberOfflineUser = vi.fn();
const retryPendingOfflineErase = vi.fn(async () => {});
const purgeRevokedOfflineDocuments = vi.fn(async () => 0);
const stopWatching = vi.fn();
const watchForOfflineDisable = vi.fn(() => stopWatching);

vi.mock('@/lib/offline-erase', () => ({
  rememberOfflineUser: (...args: Array<unknown>) =>
    rememberOfflineUser(...args),
  retryPendingOfflineErase: () => retryPendingOfflineErase(),
  purgeRevokedOfflineDocuments: (ids: Array<string>) =>
    purgeRevokedOfflineDocuments(ids),
  watchForOfflineDisable: (...args: Array<unknown>) =>
    watchForOfflineDisable(...(args as [])),
}));

const collectStale = vi.fn(async () => 0);
const close = vi.fn();
const constructed: Array<{ userId: string }> = [];

vi.mock('@/lib/wafflebase-doc-store', () => ({
  WafflebaseDocStore: class {
    constructor(options: { userId: string }) {
      constructed.push(options);
    }
    collectStale = collectStale;
    close = close;
  },
}));

const fetchDocuments = vi.fn(async () => [{ id: 'a' }, { id: 'b' }]);
const fetchDocument = vi.fn(async (id: string) => ({ id, title: 'Budget' }));

vi.mock('@/api/documents', () => ({
  fetchDocuments: () => fetchDocuments(),
  fetchDocument: (id: string) => fetchDocument(id),
}));

const listRecoverableWork = vi.fn(
  async (): Promise<Array<{ id: number; docKey: string }>> => [],
);
vi.mock('@/lib/offline-copy', () => ({
  listRecoverableWork: () => listRecoverableWork(),
}));

const recoverOfflineCopy = vi.fn(async () => ({
  documentId: 'new-1',
  title: 'Budget (offline copy)',
  complete: true,
}));
vi.mock('@/lib/offline-copy-recovery', () => ({
  recoverOfflineCopy: (...args: Array<unknown>) =>
    recoverOfflineCopy(...(args as [])),
  describeArchivedDocument: (docKey: string) =>
    docKey.startsWith('sheet-')
      ? { id: docKey.slice('sheet-'.length), type: 'sheet' }
      : undefined,
}));

const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: Array<unknown>) => toastWarning(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { OfflineRuntime } from './offline-runtime';

beforeEach(() => {
  constructed.length = 0;
  vi.clearAllMocks();
  fetchDocuments.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  listRecoverableWork.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('on mount', () => {
  it('records the signed-in identity, which is the only thing logout can erase under', async () => {
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(rememberOfflineUser).toHaveBeenCalledWith('42'));
  });

  it('finishes an erase a previous sign-out could not', async () => {
    // Somebody else's documents are still on this disk, and that account may
    // never come back to this device to try again.
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(retryPendingOfflineErase).toHaveBeenCalled());
  });

  it('installs the erase watcher and reads the identity at fire time', async () => {
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(watchForOfflineDisable).toHaveBeenCalled());
    const [storeOf, userOf] = watchForOfflineDisable.mock.calls[0] as unknown as [
      () => unknown,
      () => string,
    ];
    // Getters, never captured values — the watcher outlives a sign-out.
    expect(typeof storeOf).toBe('function');
    expect(userOf()).toBe('42');
  });

  it('runs the thirty-day sweep', async () => {
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(collectStale).toHaveBeenCalled());
  });

  it('drops copies of documents the server no longer lists', async () => {
    // Access revoked by somebody else reaches this device no other way.
    render(<OfflineRuntime userId="42" />);
    await waitFor(() =>
      expect(purgeRevokedOfflineDocuments).toHaveBeenCalledWith(['a', 'b']),
    );
  });

  it('never reconciles against a listing the server did not give', async () => {
    // The purge keeps only what is in the list, so a failed listing would
    // erase the device.
    fetchDocuments.mockRejectedValue(new Error('offline'));
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(collectStale).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(purgeRevokedOfflineDocuments).not.toHaveBeenCalled();
  });

  it('keeps sweeping when the reconcile fails', async () => {
    fetchDocuments.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
  });

  it('offers work that could not be saved, without creating anything', async () => {
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(recoverOfflineCopy).not.toHaveBeenCalled();
    const [, options] = toastWarning.mock.calls[0] as [
      string,
      { description: string },
    ];
    expect(options.description).toContain('Budget');
  });

  it('leaves an archive whose type cannot be read alone', async () => {
    // Guessing does not throw — it writes the user's content into the wrong
    // engine's shape and reports a plausible document that is not theirs.
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'mystery-7' }]);
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(collectStale).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toastWarning).not.toHaveBeenCalled();
  });
});

describe('on unmount', () => {
  it('releases the watcher and the database handle', async () => {
    const view = render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(watchForOfflineDisable).toHaveBeenCalled());
    view.unmount();
    expect(stopWatching).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('does not forget the identity', async () => {
    // Unmounting is not a sign-out: this component goes away whenever the
    // authenticated shell does — a share link, a public page — and signing out
    // from there must still erase this device's documents.
    const view = render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(rememberOfflineUser).toHaveBeenCalledWith('42'));
    view.unmount();
    expect(rememberOfflineUser).not.toHaveBeenCalledWith(undefined);
  });
});
