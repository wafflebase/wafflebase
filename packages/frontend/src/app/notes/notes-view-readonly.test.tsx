import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Document, Text } from '@yorkie-js/sdk';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

/**
 * `readOnly` reaches the note editor exactly once, at `initialize()`. The one
 * route that can flip it mid-session is `/shared/:token`, which re-resolves
 * its share link on an interval — so an `editor` → `viewer` downgrade has to
 * rebuild the editor, or the visitor keeps a fully writable one over a
 * document their link may no longer write.
 */

let initCalls: Array<boolean | undefined> = [];
let disposeCalls = 0;

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

let mockDoc: Document<YorkieNotesRoot, NotesPresence> | undefined;

vi.mock('@yorkie-js/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yorkie-js/react')>();
  return {
    ...actual,
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

vi.mock('@wafflebase/notes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wafflebase/notes')>();
  return {
    ...actual,
    initialize: (
      _container: HTMLElement,
      _store: unknown,
      _theme: unknown,
      readOnly?: boolean,
    ) => {
      initCalls.push(readOnly);
      return {
        dispose: () => {
          disposeCalls += 1;
        },
        setKeymap: () => {},
        setTheme: () => {},
        setViewMode: () => {},
        setShowAuthors: () => {},
      };
    },
  };
});

import { NotesView } from './notes-view';

beforeEach(() => {
  initCalls = [];
  disposeCalls = 0;
  mockDoc = new Document<YorkieNotesRoot, NotesPresence>('note-readonly');
  mockDoc.setActor('000000000000000000000001');
  mockDoc.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, 'hello');
  });
});

describe('NotesView read-only remount', () => {
  it('rebuilds the editor when a share link is downgraded to viewer', () => {
    const view = render(<NotesView readOnly={false} />);
    expect(initCalls).toEqual([false]);

    view.rerender(<NotesView readOnly={true} />);

    // The downgraded session must be running a read-only editor, which only
    // a rebuild can produce — `initialize()` captures `readOnly`.
    expect(initCalls).toEqual([false, true]);
    expect(disposeCalls).toBe(1);
  });

  it('releases the discarded store subscription when it rebuilds', () => {
    // The Yorkie document belongs to the `DocumentProvider` and survives the
    // rebuild, so the store the rebuild throws away must not stay subscribed
    // to it. `initialize` is mocked here, so `YorkieNoteStore`'s constructor
    // is the only subscriber and the count is exact.
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

    const view = render(<NotesView readOnly={false} />);
    expect(live).toBe(1);

    view.rerender(<NotesView readOnly={true} />);
    expect(live).toBe(1);

    view.unmount();
    expect(live).toBe(0);
  });

  it('does not rebuild the editor when readOnly is unchanged', () => {
    const view = render(<NotesView readOnly={false} viewMode="both" />);
    expect(initCalls).toEqual([false]);

    view.rerender(<NotesView readOnly={false} viewMode="view" />);

    expect(initCalls).toEqual([false]);
    expect(disposeCalls).toBe(0);
  });
});
