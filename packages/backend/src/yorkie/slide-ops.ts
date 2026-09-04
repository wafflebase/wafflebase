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
 * Every function returns a **granular change**, never a replacement array.
 * That is the whole point of these verbs existing beside `PUT .../content`:
 * `root.slides = <array>` is last-write-wins over the entire deck, so it would
 * discard every element and text edit a collaborator committed between the
 * read and the write — the exact lost update the whole-document route suffers
 * from. {@link applySlideChange} lands the change as one `splice` (or one
 * in-place reorder) on the live CRDT array instead, so an edit to any *other*
 * slide, and to the edited slide's untouched siblings, survives.
 *
 * A read → mutate → `writeSlidesRoot` round trip is avoided for a second
 * reason too: `readSlidesRoot` narrows `meta` to `{ title, themeId, masterId }`,
 * so it would silently drop `unit`, `pxPerPt`, `slideHeight` and
 * `recentColors` from a deck that had them.
 *
 * Indices on the wire are **1-based**, matching the row/column endpoints; the
 * store's own are 0-based, and the conversion happens here.
 */

export type SlideOpFailure =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'last_slide' };

/**
 * One granular edit to the `slides` array, resolved against the live array at
 * apply time (`insert-after` / `remove` / `move` carry ids, not indices, so a
 * concurrent insert elsewhere in the deck cannot make them land on the wrong
 * slide).
 */
export type SlideChange =
  | { kind: 'insert'; slide: Slide; index: number }
  | { kind: 'insert-after'; slide: Slide; afterId: string }
  | { kind: 'remove'; slideId: string }
  | { kind: 'move'; slideId: string; index: number };

export type SlideOpSuccess = {
  ok: true;
  /** The granular change to apply to the live `slides` array. */
  change: SlideChange;
  /** The slide the operation produced or acted on, when there is one. */
  id?: string;
};

export type SlideOpResult = SlideOpSuccess | SlideOpFailure;

/**
 * The slice of the array interface a Yorkie array proxy shares with a plain
 * JS array, plus the reorder methods only the proxy has.
 *
 * `moveAfterByIndex` / `moveFront` reorder *in place*, which is what keeps a
 * peer's concurrent edit to the moved slide's children — remove-and-reinsert
 * would rebuild the subtree and drop it. `yorkie-slides-store.ts#moveSlide`
 * makes the same choice for the same reason; a plain array (a unit test) has
 * neither method and falls back to the splice pair.
 */
export interface SlideArrayLike {
  readonly length: number;
  [index: number]: Slide;
  findIndex(predicate: (slide: Slide) => boolean): number;
  splice(start: number, deleteCount: number, ...items: Slide[]): Slide[];
  moveFront?(id: unknown): void;
  moveAfterByIndex?(prevIndex: number, targetIndex: number): void;
  getElementByIndex?(index: number): { getID(): unknown };
}

/**
 * Land a {@link SlideChange} on the live `slides` array. Must run inside
 * `doc.update`.
 *
 * Returns the affected slide's resulting 1-based position, or `undefined` when
 * the change removed it. Throws nothing: ids were validated against the same
 * root a moment earlier, and a slide that vanished in between is a no-op
 * rather than a 500 on an operation whose intent already happened.
 */
export function applySlideChange(
  slides: SlideArrayLike,
  change: SlideChange,
): number | undefined {
  switch (change.kind) {
    case 'insert': {
      const at = Math.min(Math.max(change.index, 0), slides.length);
      slides.splice(at, 0, change.slide);
      return at + 1;
    }
    case 'insert-after': {
      const source = slides.findIndex((s) => s.id === change.afterId);
      const at = source < 0 ? slides.length : source + 1;
      slides.splice(at, 0, change.slide);
      return at + 1;
    }
    case 'remove': {
      const at = slides.findIndex((s) => s.id === change.slideId);
      if (at >= 0) slides.splice(at, 1);
      return undefined;
    }
    case 'move': {
      const from = slides.findIndex((s) => s.id === change.slideId);
      if (from < 0) return undefined;
      const to = Math.min(Math.max(change.index, 0), slides.length - 1);
      if (to === from) return from + 1;
      if (slides.moveAfterByIndex && slides.getElementByIndex) {
        if (to === 0 && slides.moveFront) {
          slides.moveFront(slides.getElementByIndex(from).getID());
        } else if (to > from) {
          slides.moveAfterByIndex(to, from);
        } else {
          slides.moveAfterByIndex(to - 1, from);
        }
      } else {
        const [moved] = slides.splice(from, 1);
        slides.splice(to, 0, moved);
      }
      return to + 1;
    }
  }
}

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
  const length = store.read().slides.length;
  const at = toStoreIndex(position, length) ?? length;
  let id!: string;
  store.batch(() => {
    id = store.addSlide(layoutId, at);
  });
  const slide = store.read().slides.find((s) => s.id === id)!;
  return { ok: true, change: { kind: 'insert', slide, index: at }, id };
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
  const slide = store.read().slides.find((s) => s.id === id)!;
  return {
    ok: true,
    change: { kind: 'insert-after', slide, afterId: slideId },
    id,
  };
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
  return { ok: true, change: { kind: 'remove', slideId }, id: slideId };
}

/** Move a slide to a 1-based position, clamped to the deck's length. */
export function moveSlide(
  document: SlidesDocument,
  slideId: string,
  position: number,
): SlideOpResult {
  const doc = new MemSlidesStore(document).read();
  if (slideIndex(doc, slideId) < 0) return { ok: false, reason: 'not_found' };
  const target = Math.min(Math.max(position, 1), doc.slides.length) - 1;
  return {
    ok: true,
    change: { kind: 'move', slideId, index: target },
    id: slideId,
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
