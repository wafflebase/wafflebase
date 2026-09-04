import { MemSlidesStore } from '@wafflebase/slides';
import type { Layout, Slide, SlidesDocument } from '@wafflebase/slides';

/**
 * Pure per-slide operations over a `SlidesDocument`.
 *
 * The whole-document `PUT .../content` route can already replace a deck, but
 * "add a slide" through it means an agent reads the deck, hand-builds a slide
 * (placeholder elements seeded from the master's styles, fresh ids for every
 * one of them) and writes the whole thing back. That is the capability audit's
 * class-B gap for slides: the operations exist only as editor store methods.
 *
 * So these run the real ones. `MemSlidesStore` is the engine's plain-object
 * `SlidesStore` implementation — the same code the editor's Yorkie store
 * mirrors — which is what makes placeholder seeding, element-id regeneration
 * and connector-endpoint remapping on a duplicate one implementation rather
 * than a second, drifting copy.
 *
 * Every function returns the resulting `slides` array and nothing else. The
 * caller assigns *only* that back onto the Yorkie root: `readSlidesRoot`
 * narrows `meta` to `{ title, themeId, masterId }`, so a read → mutate →
 * `writeSlidesRoot` round trip would silently drop `unit`, `pxPerPt`,
 * `slideHeight` and `recentColors` from a deck that had them.
 *
 * Indices on the wire are **1-based**, matching the row/column endpoints; the
 * store's own are 0-based, and the conversion happens here.
 */

export type SlideOpFailure =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'last_slide' };

export type SlideOpSuccess = {
  ok: true;
  /** The new `slides` array to persist. */
  slides: Slide[];
  /** The slide the operation produced, when it produced one. */
  id?: string;
  /** Its 1-based position in `slides`. */
  index?: number;
};

export type SlideOpResult = SlideOpSuccess | SlideOpFailure;

function slideIndex(doc: SlidesDocument, slideId: string): number {
  return doc.slides.findIndex((s) => s.id === slideId);
}

/**
 * Clamp a 1-based wire position to an insertion slot, then hand the store the
 * 0-based index it wants. An omitted position appends.
 */
function toStoreIndex(
  position: number | undefined,
  length: number,
): number | undefined {
  if (position === undefined) return undefined;
  const clamped = Math.min(Math.max(position, 1), length + 1);
  return clamped - 1;
}

/**
 * Add a slide built from `layoutId`. The layout is resolved against the
 * deck's own layouts first and the built-in set second, which is what lets an
 * imported PPTX deck keep using its own layout ids.
 */
export function addSlide(
  document: SlidesDocument,
  layoutId: string,
  position?: number,
): SlideOpResult {
  const store = new MemSlidesStore(document);
  const doc = store.read();
  let id!: string;
  store.batch(() => {
    id = store.addSlide(layoutId, toStoreIndex(position, doc.slides.length));
  });
  const slides = store.read().slides;
  return { ok: true, slides, id, index: slides.findIndex((s) => s.id === id) + 1 };
}

/** Deep-copy a slide and insert the copy immediately after it. */
export function duplicateSlide(
  document: SlidesDocument,
  slideId: string,
): SlideOpResult {
  const store = new MemSlidesStore(document);
  if (slideIndex(store.read(), slideId) < 0) {
    return { ok: false, reason: 'not_found' };
  }
  let id!: string;
  store.batch(() => {
    id = store.duplicateSlide(slideId);
  });
  const slides = store.read().slides;
  return { ok: true, slides, id, index: slides.findIndex((s) => s.id === id) + 1 };
}

/**
 * Remove a slide. The last remaining one is refused: a deck with no slides is
 * a state the editor never produces, and an agent that wanted an empty deck
 * meant to delete the document.
 */
export function deleteSlide(
  document: SlidesDocument,
  slideId: string,
): SlideOpResult {
  const store = new MemSlidesStore(document);
  const doc = store.read();
  if (slideIndex(doc, slideId) < 0) return { ok: false, reason: 'not_found' };
  if (doc.slides.length <= 1) return { ok: false, reason: 'last_slide' };
  store.batch(() => {
    store.removeSlide(slideId);
  });
  return { ok: true, slides: store.read().slides };
}

/** Move a slide to a 1-based position, clamped to the deck's length. */
export function moveSlide(
  document: SlidesDocument,
  slideId: string,
  position: number,
): SlideOpResult {
  const store = new MemSlidesStore(document);
  const doc = store.read();
  if (slideIndex(doc, slideId) < 0) return { ok: false, reason: 'not_found' };
  const target = Math.min(Math.max(position, 1), doc.slides.length) - 1;
  store.batch(() => {
    store.moveSlide(slideId, target);
  });
  const slides = store.read().slides;
  return {
    ok: true,
    slides,
    id: slideId,
    index: slides.findIndex((s) => s.id === slideId) + 1,
  };
}

export type LayoutSummary = {
  id: string;
  name: string;
  masterId: string;
  /** Placeholder types in slot order — `['title', 'body']`. */
  placeholders: string[];
};

/**
 * The layout ids `addSlide` accepts, in the deck's own order.
 *
 * A deck imported from PPTX carries its own layouts, so this reports what
 * that document actually holds; the engine's built-in set is the fallback for
 * a deck that has none (a brand-new one created through the API), because
 * that is exactly what the store's resolution does.
 */
export function listLayouts(
  document: SlidesDocument,
  builtIns: Layout[],
): LayoutSummary[] {
  const layouts = document.layouts.length > 0 ? document.layouts : builtIns;
  return layouts.map((layout) => ({
    id: layout.id,
    name: layout.name,
    masterId: layout.masterId,
    placeholders: (layout.placeholders ?? []).map(
      (p) => p.placeholder?.type ?? 'unknown',
    ),
  }));
}
