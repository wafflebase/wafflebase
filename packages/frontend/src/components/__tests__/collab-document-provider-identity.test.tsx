import 'fake-indexeddb/auto';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * How `CollabDocumentProvider` learns who is signed in — against the real
 * React Query, deliberately.
 *
 * Every other suite that renders this component stubs `@tanstack/react-query`
 * wholesale, which is fine for what those cases are about and leaves the
 * identity query itself — the `['me', 'optional']` key, `fetchMeOptional`, and
 * the seeding from the `['me']` entry the authenticated shell already resolved
 * — asserted by nothing at all. The wiring is not incidental:
 *
 * - asking with `fetchMe` would log an anonymous share-link visitor out and
 *   hard-redirect them off the document they were sent;
 * - not seeding from `['me']` starts the query pending on a private route,
 *   which reads as "not eligible" — a wrong answer, not a missing one;
 * - and a refetch that answers `null`, which is what an expired cookie looks
 *   like, must not be able to tear the durable subtree down.
 */

const mounted: Array<Record<string, unknown>> = [];

vi.mock('@yorkie-js/react', async () => {
  const React = await import('react');
  const DocContext = React.createContext<{ doc: unknown } | undefined>(
    undefined,
  );
  const doc = { getKey: () => 'note-7', subscribe: () => () => {} };
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
    useYorkie: () => ({ client: undefined, loading: false, error: undefined }),
  };
});

const fetchMeOptional = vi.fn();
vi.mock('@/api/auth', () => ({
  fetchMeOptional: () => fetchMeOptional(),
  fetchYorkieToken: vi.fn(),
}));

import { CollabDocumentProvider } from '../collab-document-provider';
import {
  setDurableLockForTest,
  resetElectionsForTest,
  type DurableLock,
} from '@/lib/durable-session';
import { setOfflinePersistenceEnabled } from '@/lib/offline-persistence-preference';
import * as capabilities from '@/lib/yorkie-capabilities';

const ADA = { id: 7, username: 'ada', email: 'ada@example.com' };

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

let client: QueryClient;

beforeEach(() => {
  mounted.length = 0;
  fetchMeOptional.mockReset();
  fetchMeOptional.mockResolvedValue(ADA);
  vi.spyOn(capabilities, 'supportsClientKey').mockReturnValue(true);
  setDurableLockForTest(fakeLocks());
  setOfflinePersistenceEnabled('7', true);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  setDurableLockForTest(undefined);
  resetElectionsForTest();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <CollabDocumentProvider docKey="note-7" initialRoot={{}}>
        <div data-testid="child" />
      </CollabDocumentProvider>
    </QueryClientProvider>,
  );
}

describe('the identity the durability decision is made from', () => {
  it('seeds from the ["me"] entry the authenticated shell already resolved', async () => {
    // A private route has answered `["me"]` before this ever renders, and
    // `["me", "optional"]` is a different key — so without the seed the query
    // starts pending, which is a *wrong* answer rather than a missing one: the
    // document attaches on the ambient client and is then torn down and
    // re-attached on the durable one.
    client.setQueryData(['me'], ADA);
    // Never resolves, so nothing but the seed can be the source of the answer.
    fetchMeOptional.mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = mount();

    await waitFor(() => expect(mounted.length).toBe(1));
    expect(mounted[0].clientKey).toContain(':7:note-7');
    expect(getByTestId('child')).toBeTruthy();
  });

  it('asks optionally, so an anonymous visitor is never signed out', async () => {
    // `fetchMe` goes through `fetchWithAuth`, whose 401 arm logs the session
    // out and hard-redirects to /login. This renders on the public
    // `/shared/:token` route, where usually nobody is signed in.
    fetchMeOptional.mockResolvedValue(null);

    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('child')).toBeTruthy());
    expect(fetchMeOptional).toHaveBeenCalled();
    // Nothing nested: no identity, no durable client.
    expect(mounted).toEqual([]);
  });

  it('keeps the durable subtree when the session expires underneath it', async () => {
    // React Query refetches on focus, and `fetchMeOptional` answers `null` for
    // a session the server no longer accepts. Read live, that swaps the durable
    // branch for the ambient one at the same position — which unmounts the
    // `DocumentProvider` and the whole editor under it, discarding the
    // in-memory Yorkie change queue. An expired session is precisely when that
    // queue holds work the server never took.
    client.setQueryData(['me'], ADA);
    const { getByTestId } = mount();
    await waitFor(() => expect(mounted.length).toBe(1));
    // The identity of the rendered node is what says the subtree survived: a
    // remount builds a new one.
    const child = getByTestId('child');

    fetchMeOptional.mockResolvedValue(null);
    await client.refetchQueries({ queryKey: ['me', 'optional'] });
    await waitFor(() =>
      expect(client.getQueryData(['me', 'optional'])).toBeNull(),
    );

    expect(getByTestId('child')).toBe(child);
    // And still the same client key — the mock records a props object per
    // render, so a re-render is expected; a *different* key would mean the
    // provider was swapped.
    expect(mounted[mounted.length - 1].clientKey).toBe(mounted[0].clientKey);
    expect(mounted[0].clientKey).toContain(':7:note-7');
  });
});
