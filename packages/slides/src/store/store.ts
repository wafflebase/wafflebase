import type { Block } from '@wafflebase/docs';
import type { Background, SlidesDocument } from '../model/presentation';
import type { ElementInit, Frame } from '../model/element';
import type { Theme } from '../model/theme';

/**
 * SlidesStore — persistence abstraction for a presentation.
 *
 * Phase 1 ships only `MemSlidesStore`. The Yorkie-backed
 * `YorkieSlidesStore` arrives in Phase 4 in
 * `packages/frontend/src/app/slides/yorkie-slides-store.ts`.
 *
 * Mutations always go through this interface; the editor never
 * touches the underlying state directly.
 */
export interface SlidesStore {
  /** Return a deep clone of the current presentation. */
  read(): SlidesDocument;

  // --- slide-level ---

  /** Add a slide using the given layout. Returns the new slide id. */
  addSlide(layoutId: string, atIndex?: number): string;

  /** Deep-copy a slide and insert the copy immediately after it. */
  duplicateSlide(slideId: string): string;

  removeSlide(slideId: string): void;
  removeSlides(slideIds: string[]): void;

  moveSlide(slideId: string, toIndex: number): void;
  moveSlides(slideIds: string[], toIndex: number): void;

  updateSlideBackground(slideId: string, bg: Background): void;
  applyLayout(slideId: string, layoutId: string): void;

  // --- theme-level ---

  /** Add a theme to the document. Idempotent on `theme.id`. */
  addTheme(theme: Theme): void;
  /** Apply a theme as the active theme. Theme must already be in `themes[]`. */
  applyTheme(themeId: string): void;

  // --- element-level ---

  /** Insert an element on a slide. Returns the new element id. */
  addElement(slideId: string, init: ElementInit): string;
  removeElement(slideId: string, elementId: string): void;
  removeElements(slideId: string, elementIds: string[]): void;
  updateElementFrame(
    slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void;
  updateElementData(
    slideId: string,
    elementId: string,
    patch: object,
  ): void;
  /** toIndex: 0 = back, length-1 = front. */
  reorderElement(slideId: string, elementId: string, toIndex: number): void;

  // --- connector-level ---

  /** Update an endpoint of an existing connector. */
  updateConnectorEndpoint(
    slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: import('../model/connector').Endpoint,
  ): void;

  /** Replace a connector's arrowhead styles. Pass `null` per side to clear. */
  updateConnectorArrowheads(
    slideId: string,
    elementId: string,
    heads: {
      start?: import('../model/connector').ArrowheadStyle | null;
      end?:   import('../model/connector').ArrowheadStyle | null;
    },
  ): void;

  // --- text bridges (Phase 5 wires these to docs Tree) ---

  /** Mutate the rich-text body of a text element via the docs Tree. */
  withTextElement(
    slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void;
  /** Mutate a slide's speaker notes via the docs Tree. */
  withNotes(
    slideId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void;

  // --- transactions / undo ---

  /** Group all mutations made inside `fn` into one undo entry. */
  batch(fn: () => void): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
