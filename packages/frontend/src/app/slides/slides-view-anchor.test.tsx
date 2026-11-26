import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '@/types/slides-document';
import type { SlidesPresence } from '@/types/users';

/**
 * A document card's `?at=` inside the real slides views: the desktop editor
 * selects the anchored slide, the phone view makes it current, and a slide
 * deleted since the link was sent leaves the deck where it opened. Same
 * doubles as `slides-view-readonly.test.tsx` / `mobile-slides-view-seed`.
 */

let mockDoc: Document<YorkieSlidesRoot, SlidesPresence> | undefined;
let setCurrentSlide: Mock<(id: string) => void>;

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

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
    initializeEditor: () => ({
      setRulerScroll: noop,
      setHostSize: noop,
      setSlideOffset: noop,
      setCurrentSlide: (id: string) => setCurrentSlide(id),
      markDirty: noop,
      render: noop,
      setPeers: noop,
      getCellSelection: () => null,
      getCurrentSlideId: () => null,
      getSelection: () => [],
      onSelectionChange: off,
      onCurrentSlideChange: off,
      onCellSelectionChange: off,
      detach: noop,
    }),
    mountThumbnailPanel: () => ({
      refresh: noop,
      refreshContent: noop,
      dispose: noop,
    }),
    mountNotesPanel: () => ({ dispose: noop }),
    renderThumbnail: noop,
  };
});

import { encodeAnchor } from '@/components/chat/document-link';
import { MobileSlidesView } from './mobile-slides-view';
import { SlidesView } from './slides-view';
import { ensureSlidesRoot, YorkieSlidesStore } from './yorkie-slides-store';

let slideIds: string[];

beforeEach(() => {
  mockDoc = new Document<YorkieSlidesRoot, SlidesPresence>('slides-anchor');
  mockDoc.setActor('000000000000000000000001');
  ensureSlidesRoot(mockDoc);
  const store = new YorkieSlidesStore(mockDoc);
  store.batch(() => {
    store.addSlide('title-slide');
    store.addSlide('title-slide');
    store.addSlide('title-slide');
  });
  slideIds = store.read().slides.map((s) => s.id);
  setCurrentSlide = vi.fn<(id: string) => void>();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

const at = (slideId: string) =>
  `/p/d1?at=${encodeAnchor({ slideId, label: 'Slide 3' })}`;

function routed(url: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
}

describe('SlidesView ?at= anchor', () => {
  it('selects the anchored slide', async () => {
    render(<SlidesView readOnly={false} />, { wrapper: routed(at(slideIds[2])) });
    await waitFor(() => expect(setCurrentSlide).toHaveBeenCalledWith(slideIds[2]));
  });

  it('leaves the deck where it opened for a deleted slide', async () => {
    render(<SlidesView readOnly={false} />, { wrapper: routed(at('gone')) });
    await act(async () => {});
    expect(setCurrentSlide).not.toHaveBeenCalledWith('gone');
  });
});

describe('MobileSlidesView ?at= anchor', () => {
  const current = () =>
    screen
      .getAllByRole('button', { name: /^Slide \d+$/ })
      .find((b) => b.getAttribute('aria-current') === 'true')
      ?.getAttribute('aria-label');

  it('makes the anchored slide current, over the first-slide default', async () => {
    render(<MobileSlidesView mode="view" />, { wrapper: routed(at(slideIds[2])) });
    await waitFor(() => expect(current()).toBe('Slide 3'));
  });

  it('opens on the first slide for a deleted one', async () => {
    render(<MobileSlidesView mode="view" />, { wrapper: routed(at('gone')) });
    await waitFor(() => expect(current()).toBe('Slide 1'));
  });
});
