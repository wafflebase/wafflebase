# Slides Tables — lessons

## Workspace dist resolution bites twice

Frontend integration tests (`tsx --test`) resolve `@wafflebase/slides`
and `@wafflebase/docs` to their built `dist/*.es.js` / `*.d.ts`, NOT to
source. Two stale-dist failures hit while adding the P5 test:

1. `SyntaxError: ... does not provide an export named 'pushRecent'` —
   the slides `dist` was behind source. Fix: `pnpm --filter
   @wafflebase/slides build`.
2. `pnpm verify:fast` slides typecheck: `'paintOriginX' does not exist
   in type 'TextBoxEditorOptions'` — this was a **stale `@wafflebase/docs`
   `.d.ts`**, not a real type error. Source had `paintOriginX`; the dist
   `.d.ts` predated it. Fix: `pnpm --filter @wafflebase/docs build`.

**Rule:** on any "missing export" / "property does not exist on an
imported workspace type" failure, rebuild the *upstream* workspace
package (the one that owns the symbol) before suspecting a regression.
A pre-existing `verify:fast` failure on `main` that touches only an
imported workspace type is almost always this.

## "Presence" in a design doc can mean an unbuilt rendering layer

The slides-tables design doc listed P5 presence as a few new
`SlidesPresence` fields extending an "existing `textCursor`". Reality:
the slides editor renders zero peer presence today — `getPeers()` is
unconsumed and there is no `textCursor` field. Adding table presence
means building peer-overlay rendering for slides from scratch. Verify
the substrate exists before estimating a "just add fields" task.

## Per-cell table body is LWW JSON, not a CRDT Tree

`YorkieSlidesStore.withTableCellBody` snapshots `cell.body.blocks` via
`yorkieToPlain`, runs the callback, and writes the whole array back —
so cell bodies are last-writer-wins per cell, not character-mergeable
Trees (the design doc's "per-cell body Tree" is aspirational). The
integration test therefore asserts disjoint-cell convergence and
structural-op convergence, NOT same-cell character merge.

## Some "deferred" items are UI-only gaps over finished infra

The P3 "cell padding control" looked like a feature but the model
(`CellStyle.padding`), renderer (`paddingOf` with `DEFAULT_CELL_PADDING`
fallback in `table-renderer.ts`), and store (`updateTableCellStyle`
takes an arbitrary `Partial<CellStyle>` patch) already supported it
end-to-end. Only the toolbar control was missing. Before estimating a
deferred item, grep the model/renderer/store for the field — the
"feature" may be a 30-line dropdown over a fully-built pipeline.

Conversely, the per-side border picker is genuinely deferred to the
Format options panel (`slides-format-options-panel.md`); building a
standalone toolbar version now would be thrown away. Respect the
stated home for a deferred item.

## Slide typed text inherited the docs 11pt default (not slide-appropriate)

Surfaced while reviewing table cell text: any slide text typed into an
*empty* body (table cell, shape) — plus freshly inserted text boxes —
fell through to the docs engine's `DEFAULT_INLINE_STYLE.fontSize = 11`
(the Google *Docs* default), while body placeholders are 18pt
(`DEFAULT_MASTER`). PowerPoint uses 18pt for table/text, Google Slides
14pt — both far above 11. Fix: a single `SLIDES_DEFAULT_TEXT_SIZE = 18`
+ `makeDefaultSlidesTextBlock()` in `view/editor/default-text.ts`,
applied at the THREE seams that mint a new/empty slide text body:
`insert.ts` (text-box model seed) and the two edit-target builders in
`editor.ts` — shape (`body?.blocks ?? [seed]`) and cell
(`cell.body.blocks.length > 0 ? … : [seed]`). The cell stores no font
size itself; the seed lives in the typed run, so the renderer's
`deckFontScale` applies uniformly and table text now matches body text.

**Altitude trap (cost a smoke-test cycle):** the first attempt seeded the
default only in `mountSlidesTextBox` when `blocks` was empty (`[]`). But
the cell/shape target builders never pass `[]` — they pass
`[emptyShapeTextBlock()]`, a pre-seeded empty paragraph that itself
omitted `fontSize`. So the mount seed was dead code for the real paths and
smoke still showed 11 pt. The fix belongs at the seed source
(`emptyShapeTextBlock`, now folded into the shared helper), not at a
downstream chokepoint the real path skips. **Find the function that
actually mints the empty body.**

Dev note: the frontend aliases `@wafflebase/slides` → `slides/src` (Vite),
so `pnpm dev` runs source — no rebuild to smoke a slides change. The
frontend *test* lane resolves the built `dist`, so rebuild for tests.

Test note: the text-box wiring tests use a capturing/mock mount that
records `opts.blocks` — assert the seam there
(`cell-text-edit-entry.test.ts`, `text-box-editor.test.ts`), which
exercises the real target builder, not the real `mountSlidesTextBox` with
`[]` (a path the app never takes).

## Radix dropdowns in jsdom need a pointer sequence, not `.click()`

Component tests that open a Radix `DropdownMenu` must dispatch
`pointerdown` -> `pointerup` -> `click` (a synthetic `.click()` no-ops).
Pattern lifted from `line-spacing-picker.test.ts`. The menu content is
portalled into `document.body`, so query `[role="menuitem"]` off
`document.body`, not the render host. Mock only the store/editor read
surface the component actually touches (`read`, `batch`,
`updateTableCellStyle`, `getCurrentSlideId`) and cast through `unknown`.

## Scope a "presence" field to its substrate, not the design doc

The design doc listed three table presence fields (`selectedTableCells`,
`textCursorCell`, `resizingTableEdge`). Only one was actually buildable
now: `selectedTableCells`, the static analogue of the already-wired
`selectedElementIds`. The other two have no substrate to extend:
- `resizingTableEdge` is a *live drag preview*; the element-level
  `activeFrames` live-frame broadcast it pairs with is itself deferred
  (live-presence task P2 — blocked on "no single gesture-end chokepoint
  to clear" the live frames). Build table edge-resize presence with that.
- `textCursorCell` is framed as an extension of `textCursor`, but slides
  renders zero peer text carets today (only docs does). Needs that layer
  first (a separate PR per the live-presence todo).

Before estimating a presence field, check (a) does local state for it
exist, and (b) is there a *broadcast precedent* (a sibling field already
wired through `updatePresence`)? `selectedTableCells` had both
(`editor.cellSelection` + `selectedElementIds`); the other two had
neither. Same recurring theme as the earlier "verify the substrate
exists" lesson.

## Clearing an optional presence field: set it to `undefined`, guard on read

Yorkie `Presence.set` MERGES, so a field is "cleared" by broadcasting it
as `undefined` and having every consumer guard with `if (presence.field)`
(docs does exactly this for `activeCursorPos` / `activeSelection`). The
`broadcast()` in `slides-view.tsx` therefore always includes
`selectedTableCells` (value or `undefined`) — never omits the key — so a
peer's cell highlight disappears the instant they click away.

## Keep peer presence visible when a projection can be empty

First cut suppressed the cell-selected table's plain ring *unconditionally*
whenever `selectedTableCells` was set, then drew highlights. But the
cell→rect projection can legitimately return zero rects — a drag range
that lands entirely on merge-*covered* cells whose anchor sits outside the
range, or a table that was just deleted. Result: ring gone, no highlights,
peer presence invisible. Fix: project first, and suppress the ring only
when rects actually rendered. General rule — when a "replace A with B"
overlay can produce an empty B, gate the removal of A on B being non-empty.

## Test conventions

- Integration tests are auto-discovered by `tests/**/*.integration.ts`
  and run with `tsx --test` (type-stripping, no full typecheck — the
  frontend `tsconfig` `include` is `src` only, so test files are not
  project-typechecked; rely on eslint + a green run).
- Reuse `createTwoUserSlides` from `tests/helpers/two-user-slides-yorkie.ts`;
  it seeds the root and gives a 4-round `sync()` that guarantees
  convergence.
- Tables read back through the generic `data` branch of
  `readElement`, so `read().slides[i].elements[j].data.rows[r].cells[c]`
  is fully populated (body.blocks, gridSpan, rowSpan).
