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
interface StoreOptions {
  userId: string;
  isOpenElsewhere?: (docKey: string) => Promise<boolean> | boolean;
  isOpenForAnyUser?: (docKey: string) => Promise<boolean> | boolean;
}
const constructed: Array<StoreOptions> = [];

vi.mock('@/lib/wafflebase-doc-store', () => ({
  WafflebaseDocStore: class {
    constructor(options: StoreOptions) {
      constructed.push(options);
    }
    collectStale = collectStale;
    close = close;
  },
}));

const isOpenInAnyTab = vi.fn(async () => false);
vi.mock('@/lib/durable-session', () => ({
  isOpenInAnyTab: (...args: Array<unknown>) =>
    isOpenInAnyTab(...(args as [])),
}));

const fetchDocuments = vi.fn(async () => [{ id: 'a' }, { id: 'b' }]);
const fetchDocument = vi.fn(async (id: string) => ({
  id,
  title: 'Budget',
  workspaceId: 'ws-1',
}));

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
/** Where a recovered copy would be created, and whether that is a disclosure. */
const resolveRecoveryDestination = vi.fn(async (given?: string) => ({
  id: given ?? 'ws-fallback',
  shared: false,
}));
vi.mock('@/lib/offline-copy-recovery', () => ({
  recoverOfflineCopy: (...args: Array<unknown>) =>
    recoverOfflineCopy(...(args as [])),
  resolveRecoveryDestination: (given?: string) =>
    resolveRecoveryDestination(given),
  describeArchivedDocument: (docKey: string) =>
    docKey.startsWith('sheet-')
      ? { id: docKey.slice('sheet-'.length), type: 'sheet' }
      : undefined,
}));

const toastWarning = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastDismiss = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: Array<unknown>) => toastWarning(...args),
    success: (...args: Array<unknown>) => toastSuccess(...args),
    error: (...args: Array<unknown>) => toastError(...args),
    dismiss: (...args: Array<unknown>) => toastDismiss(...args),
  },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { HttpError } from '@/api/http-error';
import { OfflineRuntime } from './offline-runtime';

beforeEach(() => {
  constructed.length = 0;
  vi.clearAllMocks();
  fetchDocuments.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  fetchDocument.mockImplementation(async (id: string) => ({
    id,
    title: 'Budget',
    workspaceId: 'ws-1',
  }));
  purgeRevokedOfflineDocuments.mockResolvedValue(0);
  listRecoverableWork.mockResolvedValue([]);
  // `clearAllMocks` forgets calls, not implementations, so a resolved value
  // set by one case would otherwise be the next one's starting point.
  recoverOfflineCopy.mockResolvedValue({
    documentId: 'new-1',
    title: 'Budget (offline copy)',
    complete: true,
  });
  resolveRecoveryDestination.mockImplementation(async (given?: string) => ({
    id: given ?? 'ws-fallback',
    shared: false,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('on mount', () => {
  it('records the signed-in identity, which is the only thing logout can erase under', async () => {
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(rememberOfflineUser).toHaveBeenCalledWith('42'));
  });

  it('scopes the housekeeping store to the signed-in user', async () => {
    // Everything the store answers is scoped by this id: the thirty-day sweep,
    // and — the one that matters — the archive listing recovery reads, which
    // materializes a full snapshot as a new document owned by whoever is
    // signed in. A wrong or absent id here hands one account another account's
    // archived documents.
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(constructed.length).toBeGreaterThan(0));
    expect(constructed[0].userId).toBe('42');
  });

  it('asks the open-document guard under this user, reading unknown as not-open', async () => {
    // Collection is not eviction: a browser that cannot answer the question
    // must not switch the sweep off, and another account's open document on a
    // shared device must not defer this account's cleanup.
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(constructed.length).toBeGreaterThan(0));
    const { isOpenElsewhere } = constructed[0];
    expect(typeof isOpenElsewhere).toBe('function');
    await isOpenElsewhere!('pk/wb:1:sheet-7/sheet-7');
    expect(isOpenInAnyTab).toHaveBeenCalledWith('pk/wb:1:sheet-7/sheet-7', {
      userId: '42',
      whenUnknown: false,
    });
  });

  it('asks the sweep guard across every account, because the sweep deletes across every account', async () => {
    // `collectStale` collects whoever wrote the entry — that is the point of
    // it, since a departed user never returns to run their own housekeeping.
    // Asking whether *this* account has the document open therefore reports
    // another account's live document as idle, and collecting one makes every
    // later append in that tab vanish while its chip still reads saved.
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(constructed.length).toBeGreaterThan(0));
    const { isOpenForAnyUser } = constructed[0];
    expect(typeof isOpenForAnyUser).toBe('function');
    await isOpenForAnyUser!('pk/wb:9:sheet-7/sheet-7');
    expect(isOpenInAnyTab).toHaveBeenCalledWith('pk/wb:9:sheet-7/sheet-7', {
      whenUnknown: false,
    });
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

  it('gives the reconcile a way to tell a deletion from a revocation', async () => {
    // Without it the reconcile drops an archive on an *absence* — and "the
    // document was deleted or GC'd upstream" is one of the three causes of an
    // archive, so a deleted document is missing from `GET /documents` because
    // the archive's own cause happened. Dropping there destroys exactly the
    // unsent work the offer below exists to hand back, one step before the
    // offer is made.
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(purgeRevokedOfflineDocuments).toHaveBeenCalled());

    const [, options] = purgeRevokedOfflineDocuments.mock.calls[0] as [
      Array<string>,
      { isRevoked?: (id: string) => Promise<boolean> },
    ];
    expect(options.isRevoked).toBeTypeOf('function');

    // A 403 is the one answer that justifies destroying an archive.
    fetchDocument.mockRejectedValue(new HttpError('Forbidden', 403));
    expect(await options.isRevoked!('gone')).toBe(true);

    // A 404 is the opposite fact: deleted upstream, archive is the user's own
    // work.
    fetchDocument.mockRejectedValue(new HttpError('Not found', 404));
    expect(await options.isRevoked!('gone')).toBe(false);

    // And an answer that establishes neither keeps it.
    fetchDocument.mockRejectedValue(new Error('offline'));
    expect(await options.isRevoked!('gone')).toBe(false);

    fetchDocument.mockResolvedValue({
      id: 'gone',
      title: 'Budget',
      workspaceId: 'ws-1',
    });
    expect(await options.isRevoked!('gone')).toBe(false);
  });

  it('names a shared destination in the offer rather than after the fact', async () => {
    // Recovery is the one path here that publishes local content: it creates a
    // real document. Where the source is gone there is no workspace to
    // inherit, and the fallback can land somewhere the user merely belongs to
    // — so the click has to be agreement to that, not a surprise in a list.
    fetchDocument.mockRejectedValue(new HttpError('Not found', 404));
    resolveRecoveryDestination.mockResolvedValue({
      id: 'ws-team',
      name: 'Acme',
      shared: true,
    });
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    const [, options] = toastWarning.mock.calls[0] as [
      string,
      { description: string },
    ];
    expect(options.description).toContain('Acme');
    expect(options.description).toMatch(/share with other people/i);
  });

  it('leaves work archived when there is nowhere at all to put it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchDocument.mockRejectedValue(new HttpError('Not found', 404));
    resolveRecoveryDestination.mockRejectedValue(new Error('no workspace'));
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);

    await waitFor(() => expect(listRecoverableWork).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toastWarning).not.toHaveBeenCalled();
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

  it('offers nothing back when the purge itself failed', async () => {
    // The listing succeeding is only half of the reconcile. If the deleting
    // half failed, the archive of a workspace the user was removed from is
    // still on this disk — so a gate that opened on "the listing came back"
    // would offer exactly the content it exists to withhold.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    purgeRevokedOfflineDocuments.mockRejectedValue(new Error('idb closed'));
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);

    await waitFor(() => expect(purgeRevokedOfflineDocuments).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listRecoverableWork).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('leaves work archived when the server refuses the document', async () => {
    // A 403 says the document is still there and this user may no longer read
    // it. Offering it anyway falls back to the user's own first workspace,
    // which copies a workspace's content into one they own with their name on
    // it.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchDocument.mockRejectedValue(new HttpError('Forbidden', 403));
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);

    await waitFor(() => expect(listRecoverableWork).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('still offers work whose document was deleted upstream', async () => {
    // The case the workspace fallback exists for, and the only one that may
    // reach it: a 404 is the document being gone, not access being revoked.
    fetchDocument.mockRejectedValue(new HttpError('Not Found', 404));
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
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
  async function clickSaveACopy(): Promise<() => void> {
    listRecoverableWork.mockResolvedValue([{ id: 1, docKey: 'sheet-7' }]);
    render(<OfflineRuntime userId="42" />);
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    const [, options] = toastWarning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: (event: MouseEvent) => void } },
    ];
    expect(options.action.label).toBe('Save a copy');
    // Sonner hands the action its click event and retracts the toast unless the
    // handler prevents it, so the real button's argument is supplied here too.
    const click = () =>
      options.action.onClick(new MouseEvent('click', { cancelable: true }));
    click();
    return click;
  }

  it('hands the archive, its title, its type and its workspace to the recovery', async () => {
    // The type is read from the stored key rather than guessed: writing the
    // content into the wrong engine's shape does not throw, it produces a
    // plausible document that is not what the user wrote.
    //
    // The workspace has to travel too — a document cannot be created without
    // one, and omitting it is how "Save a copy" answered 400 every time.
    await clickSaveACopy();

    await waitFor(() => expect(recoverOfflineCopy).toHaveBeenCalled());
    const [store, item, meta] = recoverOfflineCopy.mock.calls[0] as unknown as [
      unknown,
      { id: number; docKey: string },
      { title: string; type: string; workspaceId?: string },
    ];
    expect(store).toBeDefined();
    expect(item).toEqual({ id: 1, docKey: 'sheet-7' });
    expect(meta).toEqual({
      title: 'Budget',
      type: 'sheet',
      workspaceId: 'ws-1',
    });
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

  it('retracts the offer once the work has been handed back', async () => {
    // The warning is `duration: Infinity` with no close button, so nothing else
    // ever takes it off the screen: left standing it goes on offering work that
    // is already a document, and pressing it again finds an archive the
    // recovery consumed and reports a failure for work that did not fail.
    const click = await clickSaveACopy();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastDismiss).toHaveBeenCalledWith('offline-recovery-1');

    click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recoverOfflineCopy).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('leaves the offer standing when the recovery failed', async () => {
    // Sonner retracts a toast on its action click unless the handler says
    // otherwise, and this one is asynchronous: letting it go would take the
    // offer away before anybody knew whether it worked.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    recoverOfflineCopy.mockRejectedValue(new Error('nope'));

    const click = await clickSaveACopy();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastDismiss).not.toHaveBeenCalled();

    // And it can be pressed again, because nothing was spent.
    recoverOfflineCopy.mockResolvedValue({
      documentId: 'new-3',
      title: 'Budget (offline copy)',
      complete: true,
    });
    click();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
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
