/**
 * The host half of the link card hand-off (#1124,
 * docs/design/sheets/sheet-hyperlink.md §5). The engine keeps a link cell
 * hovered while the pointer rests in the card only if the host marks the card
 * with `LinkCardAttribute`, hands the card's cell back on `pointerenter`, and
 * says when the card has gone — including when a revision preview takes it
 * away. Each of those is a line in `sheet-view.tsx` that no engine test can
 * see, so they are asserted here against the mounted view.
 *
 * Mounted the way `sheet-view-preview.test.tsx` mounts it: the engine is a
 * recording double, since it owns a canvas jsdom does not implement.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => ({ doc: fakeDoc, loading: false, error: undefined }),
}));
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/api/auth', () => ({
  fetchMeOptional: async () => ({ id: 7, username: 'alice', photo: null }),
}));
vi.mock('@/components/formatting-toolbar', () => ({
  FormattingToolbar: () => null,
}));
vi.mock('@/app/spreadsheet/yorkie-store', () => ({
  YorkieStore: class {
    ensureAxisOrder(): void {}
  },
}));
vi.mock('@wafflebase/sheets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wafflebase/sheets')>()),
  initialize: async () => fakeSheet,
}));

import { LinkCardAttribute, type LinkHoverInfo } from '@wafflebase/sheets';
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

let fakeSheet: Record<string, unknown>;

/** A recording double: unknown members are no-op spies. */
function makeFakeSheet(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    cleanup: vi.fn(),
    render: vi.fn(),
    renderOverlay: vi.fn(),
    reloadDimensions: vi.fn(async () => {}),
    recalculateCrossSheetFormulas: vi.fn(async () => {}),
    getActiveCell: vi.fn(() => undefined),
    getSelectedIndices: vi.fn(() => null),
    getSelectionType: vi.fn(() => 'cell'),
    getSelectionRangeOrActiveCell: vi.fn(() => null),
    getGridViewportRect: vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 })),
    getCellRect: vi.fn(() => ({ left: 100, top: 40, width: 100, height: 60 })),
    holdLinkCardHover: vi.fn(),
    releaseLinkCardHover: vi.fn(),
  };
  return new Proxy(base, {
    get(target, prop) {
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

function tree(previewing: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SheetView tabId={TAB_ID} previewing={previewing} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Mount, wait for `initialize`, and return the engine's hover callback. */
async function mountSheet() {
  const view = render(tree(false));
  const onLinkHover = fakeSheet.onLinkHover as Mock;
  await waitFor(() => expect(onLinkHover).toHaveBeenCalled());
  const engineHover = onLinkHover.mock.calls[0][0] as (
    info: LinkHoverInfo | null,
  ) => void;
  const rerender = (previewing: boolean) => view.rerender(tree(previewing));
  return { engineHover, rerender };
}

const cell: LinkHoverInfo = {
  sref: 'C2',
  urls: ['https://www.naver.com/', 'https://chatgpt.com/'],
};

const card = () =>
  document.body.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Links in this cell"]',
  );

beforeEach(() => {
  fakeSheet = makeFakeSheet();
});

describe('SheetView link card hand-off', () => {
  it('marks the card so the engine treats it as part of the cell', async () => {
    const { engineHover } = await mountSheet();

    act(() => engineHover(cell));

    expect(card()).not.toBeNull();
    expect(card()!.closest(`[${LinkCardAttribute}]`)).not.toBeNull();
  });

  it('hands the card’s cell to the engine when the pointer enters the card', async () => {
    const { engineHover } = await mountSheet();
    act(() => engineHover(cell));

    fireEvent.pointerEnter(card()!);

    expect(fakeSheet.holdLinkCardHover).toHaveBeenCalledExactlyOnceWith(cell);
  });

  it('tells the engine once the card has closed', async () => {
    const { engineHover } = await mountSheet();
    act(() => engineHover(cell));
    const release = fakeSheet.releaseLinkCardHover as Mock;
    release.mockClear();

    fireEvent.pointerEnter(card()!);
    fireEvent.pointerLeave(card()!);

    await waitFor(() => expect(card()).toBeNull());
    expect(release).toHaveBeenCalled();
  });

  it('closes the card when a preview opens, tells the engine, and does not bring it back', async () => {
    const { engineHover, rerender } = await mountSheet();
    act(() => engineHover(cell));
    const release = fakeSheet.releaseLinkCardHover as Mock;
    release.mockClear();

    rerender(true);
    await waitFor(() => expect(release).toHaveBeenCalled());
    expect(card()).toBeNull();

    rerender(false);
    expect(card()).toBeNull();
  });
});
