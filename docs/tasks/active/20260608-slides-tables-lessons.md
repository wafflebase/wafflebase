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

## Radix dropdowns in jsdom need a pointer sequence, not `.click()`

Component tests that open a Radix `DropdownMenu` must dispatch
`pointerdown` -> `pointerup` -> `click` (a synthetic `.click()` no-ops).
Pattern lifted from `line-spacing-picker.test.ts`. The menu content is
portalled into `document.body`, so query `[role="menuitem"]` off
`document.body`, not the render host. Mock only the store/editor read
surface the component actually touches (`read`, `batch`,
`updateTableCellStyle`, `getCurrentSlideId`) and cast through `unknown`.

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
