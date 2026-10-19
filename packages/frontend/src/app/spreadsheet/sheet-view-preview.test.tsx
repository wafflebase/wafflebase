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
// A signed-in author, so the comment popover renders its composer — the
// write affordance a preview must not leave reachable — instead of the
// anonymous read-only placeholder.
vi.mock('@/api/auth', () => ({
  fetchMeOptional: async () => ({ id: 7, username: 'alice', photo: null }),
}));
vi.mock('@/components/formatting-toolbar', () => ({
  FormattingToolbar: () => null,
}));
vi.mock('@/app/spreadsheet/yorkie-store', () => ({
  YorkieStore: class {
    // `ensureAxisOrder` is a `doc.update()` on the LIVE root — the write the
    // comment-composer shortcut makes before anything is typed — so the
    // tests below need to see whether it happened.
    ensureAxisOrder(r: number, c: number): void {
      ensureAxisOrderCalls.push([r, c]);
    }
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
/** Every `ensureAxisOrder` the view made on the live root. */
let ensureAxisOrderCalls: Array<[number, number]> = [];

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

/** Extra props a test needs on the view; defaulted so the rest ignore them. */
type Extras = { onToggleCommentsPanel?: () => void };

function tree(previewing: boolean, extras: Extras) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SheetView tabId={TAB_ID} previewing={previewing} {...extras} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Mount and wait for the async `initialize` to have wired the engine up. */
async function mountSheet(previewing = false, extras: Extras = {}) {
  const view = render(tree(previewing, extras));
  await waitFor(() => expect(selectionChangeHandlers.length).toBeGreaterThan(0));
  const rerender = (next: boolean) => view.rerender(tree(next, extras));
  return { ...view, rerender };
}

function pressFind() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
  });
}

/** Ctrl+Alt+M — open the comment composer on the active cell. */
function pressCommentComposer() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'm',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
  });
}

/** Ctrl+Alt+Shift+M — the keyboard twin of the header comments toggle. */
function pressCommentsPanelToggle() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'm',
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  });
}

/**
 * The comment popover, read off the document rather than through a role
 * query: it is positioned by a layout effect that measures a zero-size
 * wrapper in jsdom, so it renders `visibility: hidden` until a real browser
 * gives it dimensions — which would hide it from the accessibility tree the
 * role queries filter on, and this suite is asking whether it is *rendered*.
 */
function commentPopover(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"][aria-label="Comments"]');
}

beforeEach(() => {
  selectionChangeHandlers = [];
  mobileEditCallback = undefined;
  ensureAxisOrderCalls = [];
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

  /**
   * The sheet comment popover: the headline withheld surface, and the one
   * editing control a preview covers in the DOM tree but not on screen —
   * it is `absolute z-30` against the overlay's `z-20`. Every control on it
   * (the composer below, Reply, Resolve, Edit, Delete) is a `doc.update()`
   * on the LIVE document behind the banner.
   */
  it('opens the comment popover on Cmd/Ctrl+Alt+M when nothing is previewed', async () => {
    fakeSheet.getActiveCell = vi.fn(() => ({ r: 1, c: 1 }));
    await mountSheet(false);

    pressCommentComposer();

    await waitFor(() => expect(commentPopover()).not.toBeNull());
    // The write affordance itself, not merely the box around it.
    expect(commentPopover()!.querySelector('textarea')).not.toBeNull();
    expect(ensureAxisOrderCalls).toEqual([[1, 1]]);
  });

  it('refuses the comment composer shortcut while a preview is open', async () => {
    fakeSheet.getActiveCell = vi.fn(() => ({ r: 1, c: 1 }));
    await mountSheet(true);

    pressCommentComposer();

    expect(commentPopover()).toBeNull();
    // The shortcut writes axis IDs to the live root before anything is
    // typed, so refusing has to come before that, not after.
    expect(ensureAxisOrderCalls).toEqual([]);
  });

  // The popover the user opened a moment before reaching for the version
  // panel. Gating only the *shortcut* would leave this one painted above the
  // overlay, fully live.
  it('withholds an already-open comment popover and gives it back after', async () => {
    fakeSheet.getActiveCell = vi.fn(() => ({ r: 1, c: 1 }));
    const view = await mountSheet(false);
    pressCommentComposer();
    await waitFor(() => expect(commentPopover()).not.toBeNull());

    act(() => view.rerender(true));
    expect(commentPopover()).toBeNull();

    // Withholding is for the duration of the preview only — the popover's
    // own open state survives it, so closing the preview restores it.
    act(() => view.rerender(false));
    expect(commentPopover()).not.toBeNull();
  });

  /**
   * The keyboard twin of the header comments toggle, which the host removes
   * inside `EditingChrome`. Flipping `commentsPanelOpen` from under a preview
   * means closing the preview no longer gives the panel back — the exact
   * thing withholding rather than closing was for.
   */
  it('toggles the comments panel on Cmd/Ctrl+Alt+Shift+M when not previewing', async () => {
    const onToggleCommentsPanel = vi.fn();
    await mountSheet(false, { onToggleCommentsPanel });

    pressCommentsPanelToggle();

    expect(onToggleCommentsPanel).toHaveBeenCalledTimes(1);
  });

  it('refuses the comments-panel shortcut while a preview is open', async () => {
    const onToggleCommentsPanel = vi.fn();
    await mountSheet(true, { onToggleCommentsPanel });

    pressCommentsPanelToggle();

    expect(onToggleCommentsPanel).not.toHaveBeenCalled();
  });
});
