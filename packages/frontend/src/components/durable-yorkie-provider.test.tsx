import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PropsWithChildren } from 'react';

/**
 * `durable` is what the chip's "Saved to this device" stands on, and the design
 * states it as the conjunction of three facts — this tab won the app lock, no
 * loss has been reported, and the store is not failing its writes. The third is
 * the one nothing else can observe: the SDK swallows store errors, so a store
 * that accepts nothing (private browsing, an origin still full after eviction)
 * would otherwise still read as durable.
 */

interface CapturedOptions {
  onWriteFailure?: (err: unknown) => void;
  isPersistenceEnabled?: () => boolean;
  isOpenElsewhere?: (docKey: string) => Promise<boolean> | boolean;
}

const captured: Array<CapturedOptions> = [];
/** Document keys the store was told to expect a loss for. */
const expectedLosses: Array<string> = [];

vi.mock('@/lib/wafflebase-doc-store', () => ({
  WafflebaseDocStore: class {
    constructor(options: CapturedOptions) {
      captured.push(options);
    }
    expectLoss(docKey: string) {
      expectedLosses.push(docKey);
    }
  },
}));

const offlineEnabled = vi.fn(() => true);
vi.mock('@/lib/offline-persistence-preference', () => ({
  getOfflinePersistenceEnabled: () => offlineEnabled(),
}));

const writePermitted = vi.fn<(userId: string) => boolean>(() => true);
vi.mock('@/lib/offline-erase', () => ({
  isOfflineWritePermitted: (userId: string) => writePermitted(userId),
}));

const openElsewhere = vi.fn<
  (key: string, options?: unknown) => Promise<boolean>
>(async () => false);
vi.mock('@/lib/durable-session', () => ({
  isOpenInAnyTab: (key: string, options?: unknown) =>
    openElsewhere(key, options),
}));

/** The document `useDocument()` answers with, settable per case. */
let mockDoc: FakeDoc | undefined;

vi.mock('@yorkie-js/react', () => ({
  YorkieProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useDocument: () => ({ doc: mockDoc }),
  useYorkie: () => ({ error: undefined }),
}));

import {
  DurableYorkieProvider,
  DurableLossWatch,
} from './durable-yorkie-provider';
import { useDocumentDurability } from '@/lib/durable-document-context';

interface FakeDoc {
  getKey: () => string;
  subscribe: (type: string, cb: () => void) => () => void;
  /** Test control: fire one of the SDK's document events. */
  emit: (type: string) => void;
}

function fakeDoc(): FakeDoc {
  const handlers = new Map<string, Array<() => void>>();
  return {
    getKey: () => 'sheet-7',
    subscribe: (type, cb) => {
      handlers.set(type, [...(handlers.get(type) ?? []), cb]);
      return () =>
        handlers.set(
          type,
          (handlers.get(type) ?? []).filter((h) => h !== cb),
        );
    },
    emit: (type) => {
      for (const h of handlers.get(type) ?? []) h();
    },
  };
}

function Probe() {
  return <span>{useDocumentDurability() ? 'durable' : 'not-durable'}</span>;
}

function renderProvider() {
  return render(
    <DurableYorkieProvider
      clientKey="wb:1:sheet-7"
      userId="1"
      rpcAddr="http://localhost:8080"
      apiKey="key"
    >
      {/* Where `CollabDocumentProvider` mounts it: inside the document
          provider, so its `useDocument()` has something to answer with. */}
      <DurableLossWatch />
      <Probe />
    </DurableYorkieProvider>,
  );
}

beforeEach(() => {
  captured.length = 0;
  expectedLosses.length = 0;
  mockDoc = undefined;
  offlineEnabled.mockReturnValue(true);
  writePermitted.mockReturnValue(true);
  openElsewhere.mockClear();
});

describe('what the store is allowed to write', () => {
  /**
   * The store is handed a predicate rather than a boolean, and it is asked on
   * every write. Both terms matter and neither implies the other, so the
   * wiring is asserted rather than assumed — a regression here silently
   * re-writes documents to a disk the user just cleared, and no other test in
   * this suite would notice.
   */
  it('refuses writes once the preference is switched off', async () => {
    renderProvider();
    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0].isPersistenceEnabled?.()).toBe(true);

    // Deliberately *without* re-rendering: switching the preference off leaves
    // this client mounted on purpose — re-deciding durability would unmount
    // the editor and take the change queue with it — so the predicate is the
    // only thing standing between the open document and the disk.
    offlineEnabled.mockReturnValue(false);

    expect(captured[0].isPersistenceEnabled?.()).toBe(false);
  });

  it('refuses writes once this account has been signed out and erased', async () => {
    // `dropAllForUser` marks the keys it deleted, so the next append throws —
    // and the SDK repairs a failed append with a fresh snapshot, restoring the
    // whole document to the disk the sign-out cleared. The preference is still
    // on at that moment, so it cannot be the guard.
    renderProvider();
    await waitFor(() => expect(captured).toHaveLength(1));

    writePermitted.mockReturnValue(false);

    expect(offlineEnabled()).toBe(true);
    expect(captured[0].isPersistenceEnabled?.()).toBe(false);
    expect(writePermitted).toHaveBeenCalledWith('1');
  });

  it('asks about other tabs under this account', async () => {
    // A Web Lock is per origin, so an unscoped question lets another account's
    // open document answer for this one.
    renderProvider();
    await waitFor(() => expect(captured).toHaveLength(1));

    await captured[0].isOpenElsewhere?.('pk/wb:1:sheet-7/sheet-7');

    expect(openElsewhere).toHaveBeenCalledWith('pk/wb:1:sheet-7/sheet-7', {
      userId: '1',
    });
  });
});

describe('durability', () => {
  it('is reported while the store is taking writes', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());
  });

  it('stops being reported once a write fails', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());

    act(() => captured[0].onWriteFailure?.(new Error('refused')));

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
  });

  it('stops being reported once the SDK stops persisting the document', async () => {
    // The design's second conjunct. A document whose snapshot is too large or
    // too slow to write is dropped from persistence while editing carries on,
    // and the SDK says so only with this event — so without it the chip would
    // keep reading "Saved to this device" for a document nothing is saving.
    mockDoc = fakeDoc();
    renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());

    act(() => mockDoc!.emit('persist-disabled'));

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
  });

  it('keeps that answer across a re-render', async () => {
    // Latched like the other two: what was not written is not on disk, and a
    // parent re-rendering — new metadata, a presence change — must not restore
    // a promise the SDK has withdrawn.
    mockDoc = fakeDoc();
    const view = renderProvider();
    act(() => mockDoc!.emit('persist-disabled'));
    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );

    view.rerender(
      <DurableYorkieProvider
        clientKey="wb:1:sheet-7"
        userId="1"
        rpcAddr="http://localhost:8080"
        apiKey="key"
        metadata={{ userID: 'someone' }}
      >
        <DurableLossWatch />
        <Probe />
      </DurableYorkieProvider>,
    );

    expect(screen.getByText('not-durable')).toBeInTheDocument();
  });

  it('stays lowered after a later write succeeds', async () => {
    // A write that failed is work not on disk, and a later write landing does
    // not put it there.
    renderProvider();
    act(() => captured[0].onWriteFailure?.(new Error('refused')));
    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByText('not-durable')).toBeInTheDocument();
  });
});

/**
 * `DurableLossWatch` is rendered by `CollabDocumentProvider` for **every**
 * collaborative document, and `doc.subscribe` throws
 * (`YorkieError(ErrInvalidArgument, 'Unsupported event type')`) on an SDK that
 * does not know one of these event names. A throw out of a passive effect
 * propagates through render and blanks the editor, so each guard is driven
 * here rather than trusted — remove one and a pinned-SDK mismatch becomes a
 * blank screen.
 */
describe('watching a document the SDK will not let us watch', () => {
  /** A doc whose `subscribe` refuses the named events, the way the SDK does. */
  function refusingDoc(...unsupported: Array<string>): FakeDoc {
    const real = fakeDoc();
    return {
      ...real,
      subscribe: (type, cb) => {
        if (unsupported.includes(type)) {
          throw new Error(`Unsupported event type: ${type}`);
        }
        return real.subscribe(type, cb);
      },
    };
  }

  it('latches the loss and lowers durability when the loss event is refused', async () => {
    // Swallowing this was two failures at once. The chip kept promising
    // "Saved to this device" for a client that could never be told the work
    // was dropped — and this handler is the only caller of `expectLoss`, which
    // is what makes `remove()` archive the work instead of deleting it.
    mockDoc = refusingDoc('local-changes-dropped');
    renderProvider();

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
    expect(expectedLosses).toContain('sheet-7');
  });

  it('lowers durability when the persist-disabled event is refused', async () => {
    // Nothing is lost here, so nothing is archived — but a conjunct that can
    // never be lowered is not one the chip may keep asserting.
    mockDoc = refusingDoc('persist-disabled');
    renderProvider();

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
    expect(expectedLosses).toEqual([]);
  });

  it('renders rather than throwing when both are refused', async () => {
    mockDoc = refusingDoc('local-changes-dropped', 'persist-disabled');
    expect(() => renderProvider()).not.toThrow();

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
  });

  it('survives a doc-like stub with no subscribe at all', async () => {
    // Several suites answer `useDocument()` with only the members they need,
    // and this component is mounted over every collaborative document.
    mockDoc = { getKey: () => 'sheet-7' } as unknown as FakeDoc;
    expect(() => renderProvider()).not.toThrow();

    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());
  });

  it('survives an unsubscribe that throws while tearing down', async () => {
    // The cleanup side of the same problem: a throw out of an effect cleanup
    // propagates exactly as far as one out of the effect body.
    const real = fakeDoc();
    mockDoc = {
      ...real,
      subscribe: () => () => {
        throw new Error('already detached');
      },
    };
    const view = renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());

    expect(() => view.unmount()).not.toThrow();
  });

  it('still latches and reports an ordinary loss', async () => {
    // The path all of the above is defending: the SDK knows the event, fires
    // it, and the store is told this removal is a loss so the work is archived
    // rather than deleted.
    mockDoc = fakeDoc();
    renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());

    act(() => mockDoc!.emit('local-changes-dropped'));

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
    expect(expectedLosses).toContain('sheet-7');
  });
});
