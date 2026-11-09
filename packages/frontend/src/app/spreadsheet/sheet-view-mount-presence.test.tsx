/**
 * Executable coverage for the mount-time presence publish in `SheetView`.
 *
 * The engine deliberately writes no presence inside `initialize`
 * (`packages/sheets/test/view/spreadsheet-initial-presence.test.ts`), so the
 * announcement is the host's: it calls `publishSelection()` *after* the
 * `cancelled` guard, which is the whole reason the call moved out of the
 * engine. A mount torn down while `initialize` was in flight — a fast tab
 * switch, a theme toggle — must publish nothing for a tab the user has
 * already left.
 *
 * Both halves of that ordering live only here, so `initialize` is stubbed with
 * a deferred promise the test resolves by hand: that is the only way to unmount
 * while the mount is still in flight.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => ({ doc: fakeDoc, loading: false, error: undefined }),
}));
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/api/auth', () => ({
  fetchMeOptional: async () => null,
}));
vi.mock('@/components/formatting-toolbar', () => ({
  FormattingToolbar: () => null,
}));
vi.mock('@/app/spreadsheet/yorkie-store', () => ({
  YorkieStore: class {},
}));
vi.mock('@wafflebase/sheets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wafflebase/sheets')>()),
  initialize: () => initializePromise,
}));

import { TooltipProvider } from '@/components/ui/tooltip';

import { SheetView } from './sheet-view';

const TAB_ID = 't1';

const fakeRoot = {
  sheets: {
    [TAB_ID]: {
      rowOrder: [],
      colOrder: [],
      cells: {},
      comments: {},
      merges: {},
      charts: {},
      images: {},
    },
  },
  tabs: { [TAB_ID]: { name: 'Sheet1', type: 'sheet' } },
  tabOrder: [TAB_ID],
};

const fakeDoc = {
  getRoot: () => fakeRoot,
  update: vi.fn(),
  subscribe: vi.fn(() => () => {}),
};

/** The engine double, and the promise `initialize` hands back. */
let fakeSheet: Record<string, unknown>;
let initializePromise: Promise<Record<string, unknown>>;
let resolveInitialize: () => void;

/**
 * `publishSelection` and `cleanup` are spelled out rather than left to the
 * auto-stubbing proxy: these tests assert on them, and a call site renamed
 * out from under them has to fail here rather than resolve to a fresh no-op
 * that was never called.
 */
function makeFakeSheet(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    publishSelection: vi.fn(),
    cleanup: vi.fn(),
    render: vi.fn(),
    renderOverlay: vi.fn(),
    reloadDimensions: vi.fn(async () => {}),
    recalculateCrossSheetFormulas: vi.fn(async () => {}),
    getActiveCell: vi.fn(() => undefined),
    getSelectedIndices: vi.fn(() => null),
    getSelectionType: vi.fn(() => 'cell'),
    getSelectionRangeOrActiveCell: vi.fn(() => null),
    getSearchState: vi.fn(() => ({ total: 0, currentIndex: -1 })),
  };
  return new Proxy(base, {
    get(target, prop) {
      // `initialize` resolves with this object, so a synthesized `then` would
      // be treated as a thenable and hang the promise forever.
      if (typeof prop !== 'string' || prop === 'then') {
        return Reflect.get(target, prop);
      }
      if (!(prop in target)) {
        target[prop] = vi.fn(() => () => {});
      }
      return target[prop];
    },
  });
}

function tree() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SheetView tabId={TAB_ID} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fakeSheet = makeFakeSheet();
  initializePromise = new Promise((resolve) => {
    resolveInitialize = () => resolve(fakeSheet);
  });
});

describe('SheetView mount-time presence', () => {
  it('announces this tab selection once the mount survives', async () => {
    render(tree());
    resolveInitialize();

    await waitFor(() =>
      expect(fakeSheet.publishSelection).toHaveBeenCalledTimes(1),
    );
    expect(fakeSheet.cleanup).not.toHaveBeenCalled();
  });

  // The ordering the call moved out of the engine for: a mount torn down
  // while `initialize` was awaited writes no presence for the tab the user
  // has already left — it cleans the engine up and returns instead.
  it('publishes nothing when the mount was cancelled mid-initialize', async () => {
    const view = render(tree());
    view.unmount();

    resolveInitialize();
    await waitFor(() => expect(fakeSheet.cleanup).toHaveBeenCalled());

    expect(fakeSheet.publishSelection).not.toHaveBeenCalled();
  });
});
