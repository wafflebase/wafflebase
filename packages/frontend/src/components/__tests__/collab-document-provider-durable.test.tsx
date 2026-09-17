import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Where a document becomes durable.
 *
 * The nesting itself is the whole product of W3–W5: a client keyed
 * `wb:{userId}:{docKey}` with the store attached, mounted only when the opt-in
 * applies and this tab won the election — and the ambient session-wide client,
 * unchanged, every other time.
 *
 * What these cases guard is mostly the *negative* half. Mounting the durable
 * client when we should not is how two tabs end up sharing one actor, and how
 * a document that cannot be reported as durable gets persisted anyway.
 */

/** Records what the nested provider was mounted with, if it was at all. */
const mounted: Array<Record<string, unknown>> = [];

/** `local-changes-dropped` handlers the provider registered. */
const subscribers: Array<(event: unknown) => void> = [];

/** What `useYorkie()` reports, so a refused attach can be driven. */
let yorkieError: unknown;

/**
 * `useDocument()` is scoped to its provider here, exactly as the real one is.
 *
 * Not a detail. A global `useDocument()` mock reports a document to any caller
 * anywhere in the tree, which is precisely what hid the loss watch sitting
 * *above* the `DocumentProvider` it was meant to watch — there it can only ever
 * see no document, so the latch is never set and every unreconcilable removal
 * silently deletes the work instead of archiving it. With the context modelled,
 * putting it back outside fails the latch case below.
 */
vi.mock('@yorkie-js/react', async () => {
  const React = await import('react');
  const DocContext = React.createContext<{ doc: unknown } | undefined>(
    undefined,
  );
  const doc = {
    getKey: () => 'note-7',
    subscribe: (_event: string, fn: (e: unknown) => void) => {
      subscribers.push(fn);
      return () => {
        subscribers.splice(subscribers.indexOf(fn), 1);
      };
    },
  };
  return {
    DocumentProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(DocContext.Provider, { value: { doc } }, children),
    YorkieProvider: (props: Record<string, unknown>) => {
      mounted.push(props);
      return React.createElement(
        React.Fragment,
        null,
        props.children as React.ReactNode,
      );
    },
    useDocument: () => React.useContext(DocContext) ?? { doc: undefined },
    // The durable provider watches for an attach the SDK refused for its own
    // lock. `undefined` — the default for every case but one — means it never
    // fires.
    useYorkie: () => ({ client: undefined, loading: false, error: yorkieError }),
  };
});

/**
 * Who is signed in, and whether that is known yet.
 *
 * Mutable because durability cannot be decided without an identity: a pending
 * answer is a *wrong* answer, not a missing one, and the case below drives it.
 */
const me: { data?: { id: number; username: string }; isPending: boolean } = {
  data: { id: 7, username: 'ada' },
  isPending: false,
};
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => me,
  useQueryClient: () => ({ getQueryData: () => me.data }),
}));

import { CollabDocumentProvider } from '../collab-document-provider';
import { NonDurableScope } from '@/lib/use-durable-document';
import {
  setDurableLockForTest,
  resetElectionsForTest,
  type DurableLock,
} from '@/lib/durable-session';
import { setOfflinePersistenceEnabled } from '@/lib/offline-persistence-preference';
import * as capabilities from '@/lib/yorkie-capabilities';
import * as session from '@/lib/durable-session';
import { WafflebaseDocStore } from '@/lib/wafflebase-doc-store';

function fakeLocks(): DurableLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async request(name) {
      if (held.has(name)) return undefined;
      held.add(name);
      return () => held.delete(name);
    },
  };
}

let locks: ReturnType<typeof fakeLocks>;

beforeEach(() => {
  me.data = { id: 7, username: 'ada' };
  me.isPending = false;
  mounted.length = 0;
  subscribers.length = 0;
  yorkieError = undefined;
  vi.spyOn(capabilities, 'supportsClientKey').mockReturnValue(true);
  locks = fakeLocks();
  setDurableLockForTest(locks);
});

afterEach(() => {
  setDurableLockForTest(undefined);
  resetElectionsForTest();
  localStorage.clear();
  vi.restoreAllMocks();
});

function mount(docKey: string) {
  return render(
    <CollabDocumentProvider docKey={docKey} initialRoot={{}}>
      <div data-testid="child" />
    </CollabDocumentProvider>,
  );
}

describe('when the document is durable', () => {
  it('mounts a client keyed to the user and the document, with the store', async () => {
    setOfflinePersistenceEnabled(true);
    const { getByTestId } = mount('note-7');

    await waitFor(() => expect(mounted.length).toBe(1));
    expect(mounted[0].clientKey).toBe('wb:7:note-7');
    // Without a store the key would be pointless: it exists so the store's
    // `apiKey/clientKey/docKey` scope is the same one the next reload looks in.
    expect(mounted[0].store).toBeDefined();
    // And the editor still renders, on that client.
    expect(getByTestId('child')).toBeTruthy();
  });
});

describe('when it is not', () => {
  it('renders on the ambient client while the preference is off', async () => {
    const { getByTestId } = mount('note-7');

    await waitFor(() => expect(getByTestId('child')).toBeTruthy());
    // Nothing nested: declining the opt-in must cost nobody a second
    // ActivateClient, a new identity, or any change to today's behavior.
    expect(mounted).toEqual([]);
  });

  it('never persists a PDF comment document', async () => {
    // PDF documents ride this same seam and have no sync chip, so durable
    // without a way to report it would break the invariant the chip depends
    // on: whatever is durable must be reportable.
    setOfflinePersistenceEnabled(true);
    mount('pdf-123');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted).toEqual([]);
  });

  it('does not mount a second durable client for the same document', async () => {
    // Two tabs on one document is ordinary, and a stable key in both means one
    // shared actor — colliding clientSeqs, each tab's changes filtered out of
    // the other. The second must stay on today's random key.
    setOfflinePersistenceEnabled(true);
    mount('note-7');
    await waitFor(() => expect(mounted.length).toBe(1));

    resetElectionsForTest(); // a different tab
    mount('note-7');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mounted.length).toBe(1);
  });

  it('never persists anything reached through a share link', async () => {
    // Share routes mount their own `YorkieProvider` *above* this component,
    // not instead of it, so the nesting excludes nothing on its own. The
    // durable branch would give a signed-in visitor their own client,
    // authenticated with their personal Yorkie token rather than the share
    // token whose role and expiry the auth webhook validates — and would write
    // the shared document to a disk the link's revocation cannot reach.
    setOfflinePersistenceEnabled(true);
    render(
      <NonDurableScope>
        <CollabDocumentProvider docKey="note-7" initialRoot={{}}>
          <div data-testid="child" />
        </CollabDocumentProvider>
      </NonDurableScope>,
    );

    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    expect(mounted).toEqual([]);
    // And no election was taken, so a tab that *can* persist this document
    // still may.
    expect(locks.held.size).toBe(0);
  });

  it('stays on the ambient client when the build cannot carry a key', async () => {
    vi.spyOn(capabilities, 'supportsClientKey').mockReturnValue(false);
    setOfflinePersistenceEnabled(true);
    mount('note-7');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted).toEqual([]);
  });
});

describe('before the election has answered', () => {
  it('attaches nothing, rather than attaching twice', async () => {
    // Rendering the ambient client first and swapping would attach the
    // document twice on every durable open — and an edit made in that window
    // would live in a client React is about to unmount, which offline is
    // exactly where it would be lost.
    setOfflinePersistenceEnabled(true);
    const { queryByTestId, getByTestId } = mount('note-7');

    // Synchronously, before any effect has resolved the election.
    expect(queryByTestId('child')).toBeNull();

    await waitFor(() => expect(mounted.length).toBe(1));
    expect(getByTestId('child')).toBeTruthy();
  });

  it('waits for the identity rather than reading a pending one as "not eligible"', async () => {
    // The identity comes from a query the authenticated shell resolved under a
    // *different* key, so on a private route it starts out pending — and
    // deciding from that answers "not durable", mounts the ambient client,
    // attaches the document, and then tears the whole subtree down when the
    // answer arrives. Attaching nothing is the only safe thing to do while the
    // question is open.
    setOfflinePersistenceEnabled(true);
    me.data = undefined;
    me.isPending = true;

    const { queryByTestId } = mount('note-7');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(queryByTestId('child')).toBeNull();
    expect(mounted).toEqual([]);
  });

  it('renders immediately when the feature is off', async () => {
    // The answer needs no effect, so making every editor wait for one would
    // put a blank frame in front of a feature that is switched off — which is
    // every document today.
    const { getByTestId } = mount('note-7');
    expect(getByTestId('child')).toBeTruthy();
    expect(mounted).toEqual([]);
  });
});

describe('once a document is open', () => {
  it('keeps its client when the preference changes underneath it', async () => {
    // The two branches are different element types at the same position, so
    // switching between them unmounts the `DocumentProvider` and every editor
    // under it — discarding the Yorkie change queue, which on a document with
    // unsent edits is the loss this feature exists to prevent. The preference
    // is reachable from Settings and from another tab while an editor sits
    // here with work in it, so the decision is made once per open and applies
    // to the documents opened after it.
    setOfflinePersistenceEnabled(true);
    const { getByTestId } = mount('note-7');
    await waitFor(() => expect(mounted.length).toBe(1));
    // The identity of the rendered node is what says the subtree survived: a
    // remount builds a new one.
    const child = getByTestId('child');

    setOfflinePersistenceEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getByTestId('child')).toBe(child);
    expect(mounted[mounted.length - 1].clientKey).toBe('wb:7:note-7');
  });
});

describe('telling the store which removals are losses', () => {
  it("latches on the SDK's dropped-changes event", async () => {
    // Without this the store cannot tell a close from a loss — the SDK removes
    // the entry on both — and would archive a full copy of every document the
    // user ever closed.
    setOfflinePersistenceEnabled(true);
    mount('note-7');
    // The subscription, not the mount. `mounted` is pushed to during render,
    // and the watch subscribes from an effect one level below — so waiting on
    // the mount alone fires the event into an empty handler list often enough
    // to fail roughly one run in five.
    await waitFor(() => expect(subscribers.length).toBe(1));

    const store = mounted[0].store as { expectLoss(key: string): void };
    const spy = vi.spyOn(store, 'expectLoss');

    // The SDK emits this synchronously, before it calls `remove`.
    subscribers.forEach((fn) => fn({ value: { reason: 'epoch-reanchor' } }));

    expect(spy).toHaveBeenCalledWith('note-7');
  });

  it('subscribes from inside the DocumentProvider, not above it', async () => {
    // The watch reads `useDocument()`. Mounted around the provider's children
    // — which *are* the `DocumentProvider` — it sits above the context it
    // needs and can only ever see no document, so nothing subscribes and no
    // removal is ever recognised as a loss.
    setOfflinePersistenceEnabled(true);
    mount('note-7');

    await waitFor(() => expect(mounted.length).toBe(1));
    expect(subscribers.length).toBe(1);
  });
});

describe('the cross-tab guard', () => {
  it('builds the store with a liveness check that can see other tabs', async () => {
    // Without it the store knows only what this instance has touched, while
    // the ordering eviction and collection read is a shared database — so one
    // tab's sweep deletes another tab's open document and every append after
    // that silently goes nowhere.
    const openElsewhere = vi
      .spyOn(session, 'isOpenInAnyTab')
      .mockResolvedValue(true);

    setOfflinePersistenceEnabled(true);
    mount('note-7');
    await waitFor(() => expect(mounted.length).toBe(1));
    const store = mounted[0].store as WafflebaseDocStore;

    // An entry this instance never touched, aged past any cutoff, written
    // through a second store over the same database — i.e. another tab's.
    //
    // Stamped a minute back rather than now. `collectStale(0)` compares
    // against `now - 0`, so an entry written inside the same millisecond is
    // not yet stale, the sweep finds no candidate, and the liveness check this
    // case is about is never reached — a failure that showed up in roughly one
    // run in eight and said nothing about the guard.
    const other = new WafflebaseDocStore({
      userId: '7',
      dbName: store.databaseName,
      now: () => Date.now() - 60_000,
    });
    await other.saveSnapshot('sheet-9', new Uint8Array([1, 2, 3]));
    other.close();

    await store.collectStale(0);

    expect(openElsewhere).toHaveBeenCalledWith('sheet-9');
    // And it was believed: the other tab's document is still there.
    const reader = new WafflebaseDocStore({
      userId: '7',
      dbName: store.databaseName,
    });
    expect(await reader.load('sheet-9')).toBeDefined();
    reader.close();
  });
});

describe('when the SDK refuses the attach for its own lock', () => {
  it('stands down so another tab can take the election', async () => {
    // The app elects before the SDK's lock is reached, so this should not
    // fire. It is the backstop for the race where the two disagree: holding
    // the election while the attach is refused leaves this tab non-durable
    // *and* every other tab refused, which is strictly worse than having lost
    // the election in the first place.
    yorkieError = { code: 'ErrDocumentOpenElsewhere' };
    setOfflinePersistenceEnabled(true);
    mount('note-7');

    await waitFor(() => expect(mounted.length).toBe(1));
    // The name is given back, so the next tab to ask wins it.
    await waitFor(() => expect(locks.held.size).toBe(0));
  });

  it('keeps the election for any other attach failure', async () => {
    // A failed attach for another reason is not a reason to give up an
    // election that is doing its job.
    yorkieError = { code: 'ErrClientNotActivated' };
    setOfflinePersistenceEnabled(true);
    mount('note-7');

    await waitFor(() => expect(mounted.length).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(locks.held.size).toBe(1);
  });
});
