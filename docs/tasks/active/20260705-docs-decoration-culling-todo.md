# Docs: stop typing from re-scanning the whole document for decorations

## Problem

Profiling "Hello World" typing on page 1 of a long document shows ~25% of the
trace in `computeSelectionRects` (478 ms) plus ~187 ms in `findPageForPosition`
and its `findIndex` callback. Commit #444 made caret *movement* paint-only, but
*typing* mutates the document and still runs a full `render()`.

Inside `render()` (`editor.ts:1503–1573`) the decoration loops compute rects for
**every** peer selection, search match, comment marker and spell error in the
whole document, with no viewport culling. Each `computeSelectionRects` call then:

1. runs `layout.blocks.findIndex(...)` — O(blocks) linear scan
   (`selection.ts:435/438`, `pagination.ts:287`), and
2. `findPageForPosition` scans every page × every line — O(pages·lines)
   (`pagination.ts:325`).

Cost is `N_decorations × (O(blocks) + O(pages·lines))` — grows with document
length even when typing on page 1. Spell errors (hundreds in a long doc) dominate.

## Approach

- **B — block-id → index map**: memoized `getBlockIndex(layout, id)` keyed on the
  layout object (fresh per recompute → auto-invalidates). Removes the findIndex scans.
- **C — paginated line index**: memoized `getBlockPageLines(paginatedLayout)` →
  `blockIndex → PageLine[]`. `findPageForPosition` iterates only that block's lines.
- **A — viewport culling**: memoized `getBlockYExtent(paginatedLayout)` → per-block
  absolute Y bounds. In `render()`, skip decorations whose block range doesn't
  intersect the visible window (± one screenful margin).

All memoization uses `WeakMap` keyed on the layout/paginatedLayout objects, which
`computeLayout`/`paginateLayout` return fresh on every recompute and reuse across
paint-only cursor renders. No public signatures change.

## Tasks

- [x] Test: index helpers (`getBlockIndex`, `getBlockPageLines`, `getBlockYExtent`) correctness on a multi-block, multi-page fixture
- [x] Test: `findPageForPosition` returns identical results after refactor (characterization)
- [x] Test: `getBlockYExtent`-based visibility predicate keeps visible / drops offscreen blocks
- [x] Impl B+C: add memoized indexes to `pagination.ts`; rewrite `findPageForPosition`
- [x] Impl B: `selection.ts buildRects` uses `getBlockIndex`
- [x] Impl A: cull decoration loops in `editor.ts` `paint()` (preserve search-match array indices; runs on scroll via `renderPaintOnly`)
- [x] `pnpm verify:fast` green
- [ ] Self code-review over branch diff (running)
- [ ] Manual smoke: `pnpm dev`, type in a long doc with spell errors + comments; caret/selection/peer/search/comment/spell all correct on and across page boundaries
- [ ] Capture lessons; archive; PR

## Key finding during impl

The decoration loops live in `paint()` (editor.ts:1331), **not** the layout-
recomputing `render()`. `paint()` re-reads `scrollY` and reruns on every scroll
via `handleScroll → renderPaintOnly → paint`. So culling by the current viewport
is correct for scrolling: blocks scrolled into view get their decorations
computed on the scroll repaint, not left stale from the last full render.

## Review

(filled at completion)
