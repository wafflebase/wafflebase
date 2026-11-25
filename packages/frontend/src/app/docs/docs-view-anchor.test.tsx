/**
 * A document card's `?at=` applied inside the real `DocsView`: the caret is
 * placed at the start of the anchored block and scrolled to, without taking
 * focus (the chat panel the same link opens keeps it). Same doubles as
 * `docs-view-preview.test.tsx`: the docs engine and the comments controller.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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

import { encodeAnchor } from '@/components/chat/document-link';

import { DocsView } from './docs-view';

const fakeDoc = {
  // `ensureTree` leaves a document that already has a Tree alone.
  getRoot: () => ({ content: { getRootTreeNode: () => ({}) } }),
  update: vi.fn(),
  clearHistory: vi.fn(),
  subscribe: vi.fn(() => () => {}),
};

const fakeComments = {
  state: { open: [], resolved: [], orphaned: [] },
  active: null,
  composeOpen: false,
  panelOpen: false,
  canComment: true,
  beginCompose: vi.fn(),
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
};

let fakeEditor: Record<string, unknown>;

/** An editor double whose document holds the blocks in `blockIds`. */
function makeFakeEditor(blockIds: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    clearSearchMatches: vi.fn(),
    getDoc: vi.fn(() => ({
      refresh: vi.fn(),
      findBlock: (id: string) => (blockIds.includes(id) ? { id } : undefined),
    })),
    getCursorScreenRect: vi.fn(() => null),
    getLinkAtCursor: vi.fn(() => null),
    isDisposed: vi.fn(() => false),
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') {
        return Reflect.get(target, prop);
      }
      if (!(prop in target)) target[prop] = vi.fn(() => () => {});
      return target[prop];
    },
  });
}

function mountAt(search: string, previewing = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (p: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/d/doc-1${search}`]}>
        <TooltipProvider>
          <DocsView previewing={p} documentId="doc-1" />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(previewing));
  return { rerender: (p: boolean) => view.rerender(tree(p)) };
}

const at = (blockId: string) => `?at=${encodeAnchor({ blockId })}`;

beforeEach(() => {
  fakeEditor = makeFakeEditor(['b1', 'b2']);
});

describe('DocsView ?at= anchor', () => {
  it('places the caret at the start of the anchored block and scrolls to it', async () => {
    mountAt(at('b2'));
    await waitFor(() =>
      expect(fakeEditor.restoreLocalCursor).toHaveBeenCalledWith(
        { blockId: 'b2', offset: 0 },
        null,
      ),
    );
    await waitFor(() =>
      expect(fakeEditor.scrollToPosition).toHaveBeenCalledWith({
        blockId: 'b2',
        offset: 0,
      }),
    );
    // The chat panel the same link opens keeps focus.
    expect(fakeEditor.focus).not.toHaveBeenCalled();
  });

  it('leaves the editor where it opened for a deleted block', async () => {
    mountAt(at('gone'));
    // Mounted: the view has wired the editor's find request.
    await waitFor(() => expect(fakeEditor.onFindRequest).toHaveBeenCalled());
    await act(async () => {});
    expect(fakeEditor.restoreLocalCursor).not.toHaveBeenCalled();
  });

  it('waits for a revision preview to close', async () => {
    const view = mountAt(at('b1'), true);
    // Mounted: the view has wired the editor's find request.
    await waitFor(() => expect(fakeEditor.onFindRequest).toHaveBeenCalled());
    await act(async () => {});
    expect(fakeEditor.restoreLocalCursor).not.toHaveBeenCalled();

    view.rerender(false);
    await waitFor(() =>
      expect(fakeEditor.restoreLocalCursor).toHaveBeenCalledWith(
        { blockId: 'b1', offset: 0 },
        null,
      ),
    );
  });
});
