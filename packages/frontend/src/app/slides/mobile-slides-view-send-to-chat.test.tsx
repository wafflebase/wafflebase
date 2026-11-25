import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Document } from '@yorkie-js/sdk';
import type { ContextMenuItem, initializeEditor } from '@wafflebase/slides';
import type { YorkieSlidesRoot } from '@/types/slides-document';
import type { SlidesPresence } from '@/types/users';

/**
 * The phone editor's long-press menus end with "Send to chat": the canvas
 * and element menus both get it, anchored at the current slide of the deck
 * this view was mounted for. Same doubles as `mobile-slides-view-seed`.
 */

let mockDoc: Document<YorkieSlidesRoot, SlidesPresence> | undefined;
let currentSlideId: string | null = null;
type EditorOptions = Parameters<typeof initializeEditor>[0];
let editorOptions: EditorOptions | null = null;

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
  };
});

vi.mock('@wafflebase/slides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wafflebase/slides')>();
  const noop = () => {};
  const off = () => noop;
  return {
    ...actual,
    initializeEditor: (opts: EditorOptions) => {
      editorOptions = opts;
      return {
        setHostSize: noop,
        setSlideOffset: noop,
        setCurrentSlide: noop,
        markDirty: noop,
        render: noop,
        getCurrentSlideId: () => currentSlideId,
        getSelection: () => [],
        onSelectionChange: off,
        onCurrentSlideChange: off,
        detach: noop,
      };
    },
    renderThumbnail: noop,
  };
});

import { decodeAnchor } from '@/components/chat/document-link';
import {
  ChatPanelContext,
  type ChatPanelState,
} from '@/components/chat/chat-panel-context';
import { MobileSlidesView } from './mobile-slides-view';
import { ensureSlidesRoot, YorkieSlidesStore } from './yorkie-slides-store';

let slideIds: string[];
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockDoc = new Document<YorkieSlidesRoot, SlidesPresence>('slides-send-to-chat');
  mockDoc.setActor('000000000000000000000001');
  ensureSlidesRoot(mockDoc);
  const store = new YorkieSlidesStore(mockDoc);
  store.batch(() => {
    store.addSlide('title-slide');
    store.addSlide('title-slide');
  });
  slideIds = store.read().slides.map((s) => s.id);
  currentSlideId = null;
  editorOptions = null;
  open = vi.fn();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function withPanel(available: boolean) {
  const state = {
    api: { open, close: () => {}, isOpen: false },
    available,
  } as unknown as ChatPanelState;
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <ChatPanelContext.Provider value={state}>{children}</ChatPanelContext.Provider>
    </MemoryRouter>
  );
}

// What the editor passes the hooks; the entry reads neither.
const AT = { x: 0, y: 0 };
const ELEMENT = {} as Parameters<
  NonNullable<EditorOptions['hostElementMenuItems']>
>[0];

const labels = (items: ContextMenuItem[]) => items.map((item) => item.label);

/** Runs a menu's "Send to chat" and returns the anchor of the link it drafted. */
function send(items: ContextMenuItem[]) {
  items.find((item) => item.label === 'Send to chat')!.run();
  expect(open).toHaveBeenCalledTimes(1);
  const { draft } = open.mock.calls[0][0] as { draft: string };
  const url = new URL(draft);
  expect(url.pathname).toMatch(/\/p\/deck-1$/);
  return decodeAnchor(url.searchParams.get('at') ?? '', 'slides');
}

describe('MobileSlidesView Send to chat', () => {
  it('ends the canvas menu with Send to chat, anchored at the current slide', () => {
    render(<MobileSlidesView mode="edit" documentId="deck-1" />, {
      wrapper: withPanel(true),
    });
    currentSlideId = slideIds[1];
    const items = editorOptions!.hostCanvasMenuItems!(AT);
    expect(labels(items)).toEqual(['---', 'Send to chat']);
    expect(send(items)).toMatchObject({ slideId: slideIds[1], label: 'Slide 2' });
  });

  it('gives the element menu the same entry', () => {
    render(<MobileSlidesView mode="edit" documentId="deck-1" />, {
      wrapper: withPanel(true),
    });
    currentSlideId = slideIds[0];
    const items = editorOptions!.hostElementMenuItems!(ELEMENT);
    expect(send(items)).toMatchObject({ slideId: slideIds[0], label: 'Slide 1' });
  });

  it('adds nothing while the panel is withheld, or with no document', () => {
    const first = render(<MobileSlidesView mode="edit" documentId="deck-1" />, {
      wrapper: withPanel(false),
    });
    expect(editorOptions!.hostCanvasMenuItems!(AT)).toEqual([]);
    first.unmount();
    render(<MobileSlidesView mode="edit" />, { wrapper: withPanel(true) });
    expect(editorOptions!.hostElementMenuItems!(ELEMENT)).toEqual([]);
  });
});
