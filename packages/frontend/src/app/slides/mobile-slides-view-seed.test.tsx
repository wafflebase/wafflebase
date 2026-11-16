import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '@/types/slides-document';
import type { SlidesPresence } from '@/types/users';

/**
 * A brand-new deck first opened on a phone must get the same Title slide
 * the desktop mount seeds (`seedEmptyDeck`), or the mobile editor opens on
 * a blank canvas with no slide. The share-link viewer (`mode="view"`) must
 * never write, so it stays empty.
 */

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
  };
});

vi.mock('@wafflebase/slides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wafflebase/slides')>();
  const noop = () => {};
  const off = () => noop;
  return {
    ...actual,
    initializeEditor: () => ({
      setHostSize: noop,
      setSlideOffset: noop,
      setCurrentSlide: noop,
      markDirty: noop,
      render: noop,
      getCurrentSlideId: () => null,
      getSelection: () => [],
      onSelectionChange: off,
      onCurrentSlideChange: off,
      detach: noop,
    }),
    renderThumbnail: noop,
  };
});

import { MobileSlidesView } from './mobile-slides-view';

beforeEach(() => {
  mockDoc = new Document<YorkieSlidesRoot, SlidesPresence>('slides-mobile-seed');
  mockDoc.setActor('000000000000000000000001');
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // jsdom has no scrollIntoView; the filmstrip calls it on the seeded slide.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

const slideLayouts = (): string[] =>
  (mockDoc!.getRoot().slides ?? []).map((s) => s.layoutId);

describe('MobileSlidesView empty-deck seed', () => {
  it('seeds a Title slide on an edit mount', () => {
    render(<MobileSlidesView mode="edit" />);
    expect(slideLayouts()).toEqual(['title-slide']);
  });

  it('leaves the deck empty on a view (share-link viewer) mount', () => {
    render(<MobileSlidesView mode="view" />);
    expect(slideLayouts()).toEqual([]);
  });
});
