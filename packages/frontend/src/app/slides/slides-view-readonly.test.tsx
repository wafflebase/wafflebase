import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '@/types/slides-document';
import type { SlidesPresence } from '@/types/users';

/**
 * `readOnly` reaches the slides editor exactly once, at `initializeEditor()`.
 * The one route that can flip it mid-session is `/shared/:token`, which
 * re-resolves its share link on an interval — so an `editor` → `viewer`
 * downgrade has to rebuild the editor, or the visitor keeps a fully writable
 * one over a deck their link may no longer write.
 */

let initCalls: Array<boolean | undefined> = [];
let detachCalls = 0;

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

let mockDoc: Document<YorkieSlidesRoot, SlidesPresence> | undefined;

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

vi.mock('@wafflebase/slides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wafflebase/slides')>();
  const noop = () => {};
  const off = () => noop;
  return {
    ...actual,
    initializeEditor: (opts: { readOnly?: boolean }) => {
      initCalls.push(opts.readOnly);
      return {
        setRulerScroll: noop,
        setHostSize: noop,
        setSlideOffset: noop,
        markDirty: noop,
        render: noop,
        setPeers: noop,
        getCellSelection: () => null,
        getCurrentSlideId: () => null,
        getSelection: () => [],
        onSelectionChange: off,
        onCurrentSlideChange: off,
        onCellSelectionChange: off,
        detach: () => {
          detachCalls += 1;
        },
      };
    },
    mountThumbnailPanel: () => ({
      refresh: noop,
      refreshContent: noop,
      dispose: noop,
    }),
    mountNotesPanel: () => ({ dispose: noop }),
  };
});

import { SlidesView } from './slides-view';

beforeEach(() => {
  initCalls = [];
  detachCalls = 0;
  mockDoc = new Document<YorkieSlidesRoot, SlidesPresence>('slides-readonly');
  mockDoc.setActor('000000000000000000000001');
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SlidesView read-only remount', () => {
  it('rebuilds the editor when a share link is downgraded to viewer', () => {
    const view = render(<SlidesView readOnly={false} />);
    expect(initCalls).toEqual([false]);

    view.rerender(<SlidesView readOnly={true} />);

    // The downgraded session must be running a read-only editor, which only
    // a rebuild can produce — `initializeEditor()` captures `readOnly`.
    expect(initCalls).toEqual([false, true]);
    expect(detachCalls).toBe(1);
  });

  it('does not rebuild the editor when readOnly is unchanged', () => {
    const view = render(<SlidesView readOnly={false} />);
    expect(initCalls).toEqual([false]);

    view.rerender(<SlidesView readOnly={false} documentId="d1" />);

    expect(initCalls).toEqual([false]);
    expect(detachCalls).toBe(0);
  });
});
