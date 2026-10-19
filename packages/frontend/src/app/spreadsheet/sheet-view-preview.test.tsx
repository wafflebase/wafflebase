/**
 * Executable coverage for what a revision preview withholds from `SheetView`.
 *
 * The rest of the suite for this change asserts the gating on the component's
 * *source text* (`components/history/__tests__/preview-surface.test.tsx`),
 * which cannot tell a guard that works from one that is merely present. These
 * tests mount the real component and drive the real paths: the window keydown
 * handler, the engine's selection-change subscribers, and the JSX conditions
 * themselves.
 *
 * The spreadsheet engine is the one thing stubbed — it owns a canvas jsdom
 * does not implement — so `initialize` hands back a recording double and the
 * test keeps the callbacks `SheetView` registers on it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => ({ doc: fakeDoc, loading: false, error: undefined }),
}));
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/api/auth', () => ({ fetchMeOptional: async () => null }));
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

/** Callbacks `SheetView` hands the engine, captured so tests can fire them. */
let selectionChangeHandlers: Array<() => void> = [];
let mobileEditCallback: ((cellRef: string, value: string) => void) | undefined;

/**
 * Everything `SheetView` calls on the engine. Unknown members resolve to a
 * recording no-op so a future call site does not break these tests, while the
 * handful whose return value is read (promises, selection queries) are
 * spelled out.
 */
let fakeSheet: Record<string, unknown>;

function makeFakeSheet(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    cleanup: vi.fn(),
    clearFind: vi.fn(),
    commitExternalEdit: vi.fn(),
    render: vi.fn(),
    renderOverlay: vi.fn(),
    reloadDimensions: vi.fn(async () => {}),
    recalculateCrossSheetFormulas: vi.fn(async () => {}),
    find: vi.fn(async () => 0),
    getSearchState: vi.fn(() => ({ total: 0, currentIndex: -1 })),
    getActiveCell: vi.fn(() => undefined),
    getSelectedIndices: vi.fn(() => null),
    getSelectionType: vi.fn(() => 'cell'),
    getSelectionRangeOrActiveCell: vi.fn(() => null),
    onSelectionChange: vi.fn((cb: () => void) => {
      selectionChangeHandlers.push(cb);
      return () => {};
    }),
    setMobileEditCallback: vi.fn(
      (cb: (cellRef: string, value: string) => void) => {
        mobileEditCallback = cb;
      },
    ),
  };
  return new Proxy(base, {
    get(target, prop) {
      // `initialize` is `async`, so resolving with this object would treat a
      // synthesized `then` as a thenable and hang the promise forever.
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

function renderSheet(previewing: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SheetView tabId={TAB_ID} previewing={previewing} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Mount and wait for the async `initialize` to have wired the engine up. */
async function mountSheet(previewing = false) {
  const view = renderSheet(previewing);
  await waitFor(() => expect(selectionChangeHandlers.length).toBeGreaterThan(0));
  const rerender = (next: boolean) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    view.rerender(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SheetView tabId={TAB_ID} previewing={next} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  };
  return { ...view, rerender };
}

function pressFind() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
  });
}

beforeEach(() => {
  selectionChangeHandlers = [];
  mobileEditCallback = undefined;
  fakeSheet = makeFakeSheet();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SheetView under a revision preview', () => {
  it('opens the find bar on Cmd/Ctrl+F when nothing is being previewed', async () => {
    await mountSheet(false);
    pressFind();
    expect(screen.getByLabelText('Find in sheet')).toBeInTheDocument();
  });

  it('refuses the find shortcut while a preview is open', async () => {
    await mountSheet(true);
    pressFind();
    expect(screen.queryByLabelText('Find in sheet')).toBeNull();
  });

  // Withholding the bar unmounts it, and its query is its own component
  // state — the match highlights it pushed onto the engine would otherwise
  // outlive the bar that explains them, painted on the live grid.
  it('withholds an already-open find bar and clears its highlights', async () => {
    const view = await mountSheet(false);
    pressFind();
    expect(screen.getByLabelText('Find in sheet')).toBeInTheDocument();

    act(() => view.rerender(true));

    expect(screen.queryByLabelText('Find in sheet')).toBeNull();
    expect(fakeSheet.clearFind).toHaveBeenCalled();
  });

  it('withholds the mobile cell editor while a preview is open', async () => {
    const view = await mountSheet(false);
    expect(mobileEditCallback).toBeDefined();
    act(() => mobileEditCallback!('A1', 'live'));
    expect(screen.getByLabelText('Edit cell A1')).toBeInTheDocument();

    act(() => view.rerender(true));
    expect(screen.queryByLabelText('Edit cell A1')).toBeNull();
  });

  /**
   * The headline of this pair. Hiding `MobileEditPanel` does not neutralize
   * the pending edit: the engine's selection-change subscriber fires on every
   * render tick — remote-change repaints keep arriving during a preview — and
   * it used to commit the draft to the LIVE sheet and then discard it.
   */
  it('commits a pending mobile edit on a selection change when not previewing', async () => {
    await mountSheet(false);
    act(() => mobileEditCallback!('A1', 'live'));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Edit cell A1'), '!');

    // The panel ignores selection changes for 500ms after opening, to survive
    // the synthetic mouse events iOS fires after a double-tap.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);
    act(() => {
      for (const handler of selectionChangeHandlers) handler();
    });

    expect(fakeSheet.commitExternalEdit).toHaveBeenCalledWith('live!');
    expect(screen.queryByLabelText('Edit cell A1')).toBeNull();
  });

  it('never commits a pending mobile edit while a preview is open', async () => {
    const view = await mountSheet(false);
    act(() => mobileEditCallback!('A1', 'live'));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Edit cell A1'), '!');

    act(() => view.rerender(true));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);
    act(() => {
      for (const handler of selectionChangeHandlers) handler();
    });

    expect(fakeSheet.commitExternalEdit).not.toHaveBeenCalled();

    // And the draft is held rather than discarded, so closing the preview
    // gives the panel back exactly as it was.
    act(() => view.rerender(false));
    expect(screen.getByLabelText('Edit cell A1')).toBeInTheDocument();
  });

  /**
   * The grid's context menu is a `document.body` portal at `z-50`, so it
   * leaves the surface box the overlay covers — Cut / Paste / Insert / Delete
   * on it all write the LIVE sheet. It cannot be unmounted (that would remount
   * the canvas container it wraps), so the trigger is disabled in place and
   * the selection side effect of opening it is refused with it.
   */
  it('opens the grid context menu when nothing is being previewed', async () => {
    const view = await mountSheet(false);
    const grid = view.container.querySelector('[data-sheet-container]')!;
    fireEvent.contextMenu(grid);
    expect(await screen.findByText('Copy')).toBeInTheDocument();
  });

  it('withholds the grid context menu while a preview is open', async () => {
    const view = await mountSheet(true);
    const grid = view.container.querySelector('[data-sheet-container]')!;
    fireEvent.contextMenu(grid);

    expect(screen.queryByText('Copy')).toBeNull();
    // And nothing moved the live selection on the way: Radix leaves our own
    // `onContextMenu` wired on a disabled trigger.
    expect(fakeSheet.selectStart).not.toHaveBeenCalled();
    expect(fakeSheet.headerHitTest).not.toHaveBeenCalled();
  });
});
