import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Document } from '@yorkie-js/sdk';
import type { ReactNode } from 'react';
import type { YorkieDocsRoot } from '@/types/docs-document';
import type { DocsPresence } from '@/types/users';

/**
 * `readOnly` reaches the docs editor exactly once, at `initialize()` — it
 * decides whether the store is wrapped in `readOnlyDocStore` and gates every
 * write path inside the editor. The one route that can flip it mid-session is
 * `/shared/:token`, which re-resolves its share link on an interval, so an
 * `editor` → `viewer` downgrade has to rebuild the editor or the visitor keeps
 * a fully writable one over a document their link may no longer write.
 *
 * The twin of `notes-view-readonly.test.tsx` and
 * `slides-view-readonly.test.tsx`. `YorkieDocStore.dispose()` is asserted the
 * same way the notes one is: the Yorkie document belongs to the enclosing
 * `DocumentProvider` and outlives the rebuild, so the store the rebuild throws
 * away must not stay subscribed to it.
 */

let initCalls: Array<boolean | undefined> = [];
let disposeCalls = 0;

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('@/api/auth', () => ({
  fetchMeOptional: async () => null,
}));

let mockDoc: Document<YorkieDocsRoot, DocsPresence> | undefined;

vi.mock('@yorkie-js/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yorkie-js/react')>();
  return {
    ...actual,
    // Named explicitly: spreading this module's namespace does not carry
    // `Tree` through, and `ensureTree` in the view under test needs the real
    // one — the copy the provider's own SDK recognizes.
    Tree: actual.Tree,
    useDocument: () => ({
      doc: mockDoc,
      root: mockDoc?.getRoot(),
      presences: [],
      connection: 'connected',
      loading: false,
      error: undefined,
    }),
    usePresences: () => [],
  };
});

/**
 * Everything `DocsView` and its children reach on the editor at mount. The
 * fallback is a no-op function so a new wiring call does not have to be added
 * here; the handful of reads that must return a shape are named explicitly.
 * Symbol and `then` lookups answer `undefined` so the stub can never be
 * mistaken for a thenable.
 */
function makeEditorStub(): unknown {
  const named: Record<string, unknown> = {
    dispose: () => {
      disposeCalls += 1;
    },
    getDoc: () => ({ document: { blocks: [] } }),
    getPeerCursorPixels: () => [],
    getActiveSelection: () => null,
    getLinkAtCursor: () => undefined,
    getCursorScreenRect: () => null,
    getCommentMarkerAt: () => undefined,
    getTableMergeContext: () => null,
    isInTable: () => false,
    isComposing: () => false,
    getSpellErrorAt: () => undefined,
    getSpellSuggestions: async () => [],
    positionAtClientPoint: () => null,
  };
  return new Proxy(named, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (prop in target) return target[prop as string];
      return () => {};
    },
  });
}

vi.mock('@wafflebase/docs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wafflebase/docs')>();
  return {
    ...actual,
    initialize: (
      _container: HTMLElement,
      _store: unknown,
      _theme: unknown,
      readOnly?: boolean,
    ) => {
      initCalls.push(readOnly);
      return makeEditorStub();
    },
  };
});

import { DocsView } from './docs-view';

let client: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  initCalls = [];
  disposeCalls = 0;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mockDoc = new Document<YorkieDocsRoot, DocsPresence>('docs-readonly');
  mockDoc.setActor('000000000000000000000001');
});

describe('DocsView read-only remount', () => {
  it('rebuilds the editor when a share link is downgraded to viewer', () => {
    const view = render(
      <Wrapper>
        <DocsView readOnly={false} />
      </Wrapper>,
    );
    expect(initCalls).toEqual([false]);

    view.rerender(
      <Wrapper>
        <DocsView readOnly={true} />
      </Wrapper>,
    );

    // The downgraded session must be running a read-only editor, which only a
    // rebuild can produce — `initialize()` captures `readOnly`.
    expect(initCalls).toEqual([false, true]);
    expect(disposeCalls).toBe(1);
  });

  it('releases the discarded store subscription when it rebuilds', () => {
    // Counted rather than pinned to a number: a mount opens several
    // subscriptions on the shared document (the store's constructor, the
    // view's own `others` presence watch, the comments controller). What
    // matters is that a rebuild opens no *net* new one — without
    // `store.dispose()` the thrown-away store stays subscribed and keeps
    // refreshing and publishing presence from the editor the rebuild just
    // disposed.
    let live = 0;
    const real = mockDoc!.subscribe.bind(mockDoc!);
    (mockDoc as unknown as { subscribe: unknown }).subscribe = (
      ...args: unknown[]
    ) => {
      live += 1;
      const unsubscribe = (real as (...a: unknown[]) => () => void)(...args);
      return () => {
        live -= 1;
        unsubscribe();
      };
    };

    const view = render(
      <Wrapper>
        <DocsView readOnly={false} />
      </Wrapper>,
    );
    const atMount = live;
    expect(atMount).toBeGreaterThan(0);

    view.rerender(
      <Wrapper>
        <DocsView readOnly={true} />
      </Wrapper>,
    );
    expect(live).toBe(atMount);

    view.unmount();
    expect(live).toBe(0);
  });

  it('does not rebuild the editor when readOnly is unchanged', () => {
    const view = render(
      <Wrapper>
        <DocsView readOnly={false} />
      </Wrapper>,
    );
    expect(initCalls).toEqual([false]);

    view.rerender(
      <Wrapper>
        <DocsView readOnly={false} commentsPanelOpen={true} />
      </Wrapper>,
    );

    expect(initCalls).toEqual([false]);
    expect(disposeCalls).toBe(0);
  });
});
