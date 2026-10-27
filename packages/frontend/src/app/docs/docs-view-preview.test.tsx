/**
 * Executable coverage for what a revision preview withholds from `DocsView`.
 *
 * The twin of `app/spreadsheet/sheet-view-preview.test.tsx`, and for the same
 * reason: the rest of this change's suite asserts the gating on the source
 * text, which cannot tell a guard that works from one that is merely present.
 * These mount the real component and drive the real paths — the editor's own
 * find request, the window keydown handler, and the JSX conditions.
 *
 * Two things are stubbed: the docs engine (it owns a canvas jsdom does not
 * implement) and the comments controller (it reads a live Yorkie Tree). What
 * is under test — which `previewing` expression gates which render site — is
 * `DocsView`'s own code, and that runs for real.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => ({ doc: fakeDoc, loading: false, error: undefined }),
  Tree: class {},
}));
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@/api/auth', () => ({ fetchMeOptional: async () => null }));
vi.mock('./yorkie-doc-store', () => ({
  YorkieDocStore: class {
    constructor() {
      // Same shape as the editor double below: the handful of members whose
      // return value is read are real, the rest are tolerated no-ops.
      const base: Record<string, unknown> = {
        getPresences: () => [],
        resolveAnchoredLocalCursor: () => ({ cursor: null, selection: null }),
      };
      return new Proxy(base, {
        get(target, prop) {
          if (typeof prop !== 'string' || prop === 'then') {
            return Reflect.get(target, prop);
          }
          if (!(prop in target)) target[prop] = () => undefined;
          return target[prop];
        },
      });
    }
  },
}));
vi.mock('./comments/docs-comments-controller', () => ({
  useDocsComments: () => fakeComments,
}));
vi.mock('@wafflebase/docs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wafflebase/docs')>()),
  initialize: () => fakeEditor,
}));

import { TooltipProvider } from '@/components/ui/tooltip';

import { DocsView } from './docs-view';

const fakeDoc = {
  // `ensureTree` leaves a document that already has a Tree alone.
  getRoot: () => ({ content: { getRootTreeNode: () => ({}) } }),
  update: vi.fn(),
  clearHistory: vi.fn(),
  subscribe: vi.fn(() => () => {}),
};

const thread = {
  id: 'dt1',
  anchor: { kind: 'docs-range', quotedText: 'anchored text' },
  comments: [
    {
      id: 'dc1',
      author: { userId: 'u1', username: 'alice' },
      body: 'the comment body',
      createdAt: 1_700_000_000_000,
    },
  ],
  resolved: false,
  createdAt: 1_700_000_000_000,
};

/** The controller's surface, as `DocsView` consumes it. */
let fakeComments: Record<string, unknown>;

function makeComments(overrides: Record<string, unknown> = {}) {
  return {
    state: { open: [], resolved: [], orphaned: [] },
    active: null,
    composeOpen: false,
    panelOpen: false,
    canComment: true,
    beginCompose: vi.fn(() => true),
    togglePanel: vi.fn(),
    closeCompose: vi.fn(),
    closePanel: vi.fn(),
    dismissPopover: vi.fn(),
    jumpToThread: vi.fn(),
    reply: vi.fn(),
    toggleResolved: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    submitNewComment: vi.fn(),
    ...overrides,
  };
}

/** Callbacks `DocsView` hands the editor, captured so tests can fire them. */
let findRequest: (() => void) | undefined;
let fakeEditor: Record<string, unknown>;

function makeFakeEditor(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    clearSearchMatches: vi.fn(),
    getDoc: vi.fn(() => ({ refresh: vi.fn() })),
    getCursorScreenRect: vi.fn(() => null),
    getLinkAtCursor: vi.fn(() => null),
    onFindRequest: vi.fn((cb: () => void) => {
      findRequest = cb;
    }),
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
        <DocsView previewing={previewing} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

async function mountDocs(previewing = false) {
  const view = render(tree(previewing));
  await waitFor(() => expect(findRequest).toBeDefined());
  return {
    ...view,
    rerender: (next: boolean) => view.rerender(tree(next)),
  };
}

beforeEach(() => {
  findRequest = undefined;
  fakeEditor = makeFakeEditor();
  fakeComments = makeComments();
});

describe('DocsView under a revision preview', () => {
  it('opens the find bar when nothing is being previewed', async () => {
    await mountDocs(false);
    act(() => findRequest!());
    expect(screen.getByPlaceholderText('Find')).toBeInTheDocument();
  });

  // Withholding the bar unmounts it, and its query is its own component
  // state — the highlights it pushed onto the editor would otherwise outlive
  // the bar that explains them, painted on the live document.
  it('withholds an open find bar and clears its highlights', async () => {
    const view = await mountDocs(false);
    act(() => findRequest!());
    expect(screen.getByPlaceholderText('Find')).toBeInTheDocument();

    act(() => view.rerender(true));

    expect(screen.queryByPlaceholderText('Find')).toBeNull();
    expect(fakeEditor.clearSearchMatches).toHaveBeenCalled();
    // Not `clearSearchMatches(true)`: moving the caret to the last match
    // publishes presence from a document the user is no longer looking at.
    expect(fakeEditor.clearSearchMatches).not.toHaveBeenCalledWith(true);
  });

  it('withholds the comment popover while a preview is open', async () => {
    fakeComments = makeComments({
      active: { thread, anchorRect: { x: 0, y: 0, width: 10, height: 10 } },
    });
    const view = await mountDocs(false);
    expect(document.body.textContent).toContain('the comment body');

    act(() => view.rerender(true));
    // Asked of the whole document: a portal still renders into `body`.
    expect(document.body.textContent).not.toContain('the comment body');
  });

  it('withholds the insert-comment dialog while a preview is open', async () => {
    fakeComments = makeComments({ composeOpen: true });
    const view = await mountDocs(false);
    expect(
      screen.getByRole('dialog', { name: 'Insert comment' }),
    ).toBeInTheDocument();

    act(() => view.rerender(true));
    expect(screen.queryByRole('dialog', { name: 'Insert comment' })).toBeNull();
  });

  // Bound on `window`, so the preview's capture-phase suppressor only covers
  // it once that lazy chunk has mounted. Flipping state nothing will render
  // is the bug it exists to prevent.
  it.each([
    { previewing: false, calls: 1 },
    { previewing: true, calls: 0 },
  ])(
    'routes the comment shortcut to the controller only when not previewing (previewing=$previewing)',
    async ({ previewing, calls }) => {
      await mountDocs(previewing);
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'm',
            ctrlKey: true,
            altKey: true,
          }),
        );
      });
      expect(fakeComments.beginCompose).toHaveBeenCalledTimes(calls);
    },
  );
});
