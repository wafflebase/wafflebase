import 'fake-indexeddb/auto';
import { render, waitFor } from '@testing-library/react';
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

vi.mock('@yorkie-js/react', () => ({
  DocumentProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  YorkieProvider: (props: Record<string, unknown>) => {
    mounted.push(props);
    return <>{props.children as React.ReactNode}</>;
  },
  useDocument: () => ({ doc: undefined }),
  // The durable provider watches for an attach the SDK refused for its own
  // lock. No error here means it never fires, which is the case these cases
  // are about.
  useYorkie: () => ({ client: undefined, loading: false, error: undefined }),
}));

const me = { data: { id: 7, username: 'ada' } };
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => me,
}));

import { CollabDocumentProvider } from '../collab-document-provider';
import {
  setDurableLockForTest,
  resetElectionsForTest,
  type DurableLock,
} from '@/lib/durable-session';
import { setOfflinePersistenceEnabled } from '@/lib/offline-persistence-preference';
import * as capabilities from '@/lib/yorkie-capabilities';

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

beforeEach(() => {
  mounted.length = 0;
  vi.spyOn(capabilities, 'supportsClientKey').mockReturnValue(true);
  setDurableLockForTest(fakeLocks());
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

  it('renders immediately when the feature is off', async () => {
    // The answer needs no effect, so making every editor wait for one would
    // put a blank frame in front of a feature that is switched off — which is
    // every document today.
    const { getByTestId } = mount('note-7');
    expect(getByTestId('child')).toBeTruthy();
    expect(mounted).toEqual([]);
  });
});
