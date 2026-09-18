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
const purgeRevokedOfflineDocuments =
  vi.fn<(...args: Array<unknown>) => Promise<number>>(async () => 0);
const stopWatching = vi.fn();
const watchForOfflineDisable = vi.fn(() => stopWatching);

vi.mock('@/lib/offline-erase', () => ({
  rememberOfflineUser: (...args: Array<unknown>) =>
    rememberOfflineUser(...args),
  retryPendingOfflineErase: () => retryPendingOfflineErase(),
  purgeRevokedOfflineDocuments: (...args: Array<unknown>) =>
    purgeRevokedOfflineDocuments(...(args as [Array<string>])),
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
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: Array<unknown>) => toastWarning(...args),
    success: (...args: Array<unknown>) => toastSuccess(...args),
    error: (...args: Array<unknown>) => toastError(...args),
  },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { OfflineRuntime } from './offline-runtime';

beforeEach(() => {
  constructed.length = 0;
  vi.clearAllMocks();
  fetchDocuments.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  listRecoverableWork.mockResolvedValue([]);
  // `clearAllMocks` forgets calls, not implementations, so a resolved value
  // set by one case would otherwise be the next one's starting point.
  recoverOfflineCopy.mockResolvedValue({
    documentId: 'new-1',
    title: 'Budget (offline copy)',
    complete: true,
  });
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
      expect(purgeRevokedOfflineDocuments).toHaveBeenCalledWith(
        ['a', 'b'],
        expect.anything(),
      ),
    );
  });

  it('tells the reconcile what it may not judge on an absence', async () => {
    // The listing answers for the moment it was asked, over a database shared
    // with this user's other tabs: a document created or opened in one of them
    // is missing from it for no reason at all. Without these the reconcile
    // deletes it, and every later append in that tab silently goes nowhere.
    const before = Date.now();
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(purgeRevokedOfflineDocuments).toHaveBeenCalled());
    const [ids, options] = purgeRevokedOfflineDocuments.mock.calls[0] as [
      Array<string>,
      { listedAt?: number; isOpenElsewhere?: unknown },
    ];
    expect(ids).toEqual(['a', 'b']);
    expect(options.listedAt).toBeGreaterThanOrEqual(before);
    expect(typeof options.isOpenElsewhere).toBe('function');
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

  it('offers nothing back when the reconcile could not run', async () => {
    // Recovery does not hand work back to an editor: it materializes an
    // archive — a full snapshot of a document — as a new server-side document
    // owned by whoever is signed in. The reconcile is the only thing on this
    // device that knows an archive belongs to a workspace the user has since
    // been removed from; every other purge runs on the device of whoever made
    // the request. Offering anyway when it failed is how content the user may
    // no longer read gets copied back into their own workspace with their name
    // on it — and offline, where this feature is meant to be used, is exactly
    // when the listing fails.
    fetchDocuments.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);

    await waitFor(() => expect(collectStale).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listRecoverableWork).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    // The sweep before it still ran — declining to offer is not declining to
    // clean up.
    expect(collectStale).toHaveBeenCalled();
  });

  it('offers it back once access has been reconciled', async () => {
    // The declined offer is made again next session, so the cost of waiting
    // for a reconcile is a delay and nothing else.
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(purgeRevokedOfflineDocuments).toHaveBeenCalled();
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

describe('accepting the offer', () => {
  /**
   * The payoff path. Everything else in this feature exists so that a person
   * whose work could not be reconciled can press one button and get it back as
   * a document — and that button's handler is the only place the store, the
   * archive, the document type and the navigation are brought together.
   */
  async function clickSaveACopy(): Promise<void> {
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    const [, options] = toastWarning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBe('Save a copy');
    options.action.onClick();
  }

  it('hands the archive, its title and its type to the recovery', async () => {
    // The type is read from the stored key rather than guessed: writing the
    // content into the wrong engine's shape does not throw, it produces a
    // plausible document that is not what the user wrote.
    await clickSaveACopy();

    await waitFor(() => expect(recoverOfflineCopy).toHaveBeenCalled());
    const [store, item, meta] = recoverOfflineCopy.mock.calls[0] as unknown as [
      unknown,
      { id: number; docKey: string },
      { title: string; type: string },
    ];
    expect(store).toBeDefined();
    expect(item).toEqual({ id: 1, docKey: 'sheet-7' });
    expect(meta).toEqual({ title: 'Budget', type: 'sheet' });
  });

  it('offers to open what it recovered, at that type’s route', async () => {
    await clickSaveACopy();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0] as [
      string,
      { description?: string; action: { onClick: () => void } },
    ];
    expect(message).toContain('Budget (offline copy)');
    // Complete, so nothing is hedged.
    expect(options.description).toBeUndefined();

    options.action.onClick();
    expect(navigate).toHaveBeenCalledWith('/s/new-1');
  });

  it('says so when only part of the stored work could be replayed', async () => {
    recoverOfflineCopy.mockResolvedValue({
      documentId: 'new-2',
      title: 'Budget (offline copy)',
      complete: false,
    });

    await clickSaveACopy();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [, options] = toastSuccess.mock.calls[0] as [
      string,
      { description?: string },
    ];
    expect(options.description).toContain('incomplete');
  });

  it.each([
    ['empty', 'nothing left to recover'],
    ['unsupported-type', 'cannot be recovered'],
    [undefined, 'could not be read'],
  ])('reports a refusal (%s) rather than a document', async (refused, said) => {
    // A refusal must never read as success: the archive is still the only copy
    // of that work, and a success toast would invite the user to stop looking.
    recoverOfflineCopy.mockResolvedValue({
      documentId: undefined,
      refused,
      title: '',
      complete: false,
    } as unknown as {
      documentId: string;
      title: string;
      complete: boolean;
    });

    await clickSaveACopy();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const [, options] = toastError.mock.calls[0] as [
      string,
      { description: string },
    ];
    expect(options.description).toContain(said);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('survives a recovery that throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    recoverOfflineCopy.mockRejectedValue(new Error('nope'));

    await clickSaveACopy();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
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
