// An in-memory board store, with the REAL board's refusals.
//
// WHY NOT JUST `MemSlidesStore`. A board is a `SlidesStore` over one synthetic slide, so
// `MemSlidesStore` looks like a drop-in — and it is wrong in the direction that matters.
// `YorkieBoardStore` REFUSES 34 of the ~70 `SlidesStore` methods: every slide, theme,
// master, layout, animation, guide and table operation throws, because a board has one
// unbounded plane and none of those concepts. `MemSlidesStore` performs all of them happily.
//
// A harness that is LAXER than production is worse than one that is stricter. A stricter
// harness manufactures false findings, which the rubric can warn about and a verifier can
// refute. A laxer one lets the explorer add slides and apply themes to a "board", watch them
// work, and conclude the surface is fine — hiding the constraint instead of exposing it, with
// nothing to catch it. So the refusals are part of the surface under test.
//
// The list below is PINNED BY TEST against `yorkie-board-store.ts`, so a method that starts
// or stops being supported there fails here rather than silently diverging.

import type { SlidesStore } from "@wafflebase/slides";

/**
 * Every `SlidesStore` method a board refuses.
 *
 * Derived by reading which methods call `notSupported()` in `YorkieBoardStore`; the test
 * re-derives it from that file and asserts the two agree.
 */
export const BOARD_UNSUPPORTED: readonly string[] = [
  "addAnimation",
  "addGuide",
  "addSlide",
  "addTheme",
  "applyLayout",
  "applyTheme",
  "deleteTableColumn",
  "deleteTableRow",
  "duplicateSlide",
  "insertTableColumn",
  "insertTableRow",
  "mergeTableCells",
  "moveGuide",
  "moveSlide",
  "moveSlides",
  "removeAnimation",
  "removeGuide",
  "removeSlide",
  "removeSlides",
  "reorderAnimation",
  "setSlideHeight",
  "setSlideTransition",
  "unmergeTableCells",
  "updateAnimation",
  "updateLayout",
  "updateLayoutPlaceholderFrame",
  "updateMaster",
  "updateSlideBackground",
  "updateTableCellStyle",
  "updateTableColumnWidths",
  "updateTableRowHeights",
  "updateTheme",
  "withNotes",
  "withTableCellBody",
];

/**
 * Wrap a `MemSlidesStore` so it refuses what a board refuses.
 *
 * A PROXY rather than a subclass, because the supported surface is ~40 methods that must
 * pass through UNCHANGED. Listing them would be a second place to forget one, and forgetting
 * one there is silent — the explorer just finds a method missing. Only the refusals are
 * enumerated, and only they are pinned.
 *
 * The message matches `YorkieBoardStore`'s wording so a refusal reads the same in the hunt
 * journal as it would in the product.
 */
export function asBoardStore<T extends SlidesStore>(inner: T): T {
  const refused = new Set(BOARD_UNSUPPORTED);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && refused.has(prop)) {
        return () => {
          throw new Error(`YorkieBoardStore: "${prop}" is not supported on a board`);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      // Methods are bound to the INNER store, not the proxy. Unbound, a delegated call whose
      // body reaches another method would go back through this trap — so an internal use of,
      // say, `addGuide` would start throwing where the real store's would not.
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
