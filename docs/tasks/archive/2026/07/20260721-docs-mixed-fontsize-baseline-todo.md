# Docs — Mixed font-size runs share a common baseline

## Context

On a single line containing runs of different font sizes, smaller glyphs
floated upward instead of resting on a shared baseline (Google Docs aligns
mixed-size text along the bottom). Root cause: the alphabetic baseline in
`renderRun` was derived from **each run's own font size**
(`originalFontSizePx`), so a smaller run computed a smaller `baselineY` and
sat higher. The base baseline must instead come from the line's tallest
run so every run on the line shares one baseline.

Reported issue + repro: type 36pt text, then 11pt text on the same line —
the 11pt text should rest on the 36pt baseline.

Scope: **screen text only** — the shared canvas painter
`renderRun` in `packages/docs/src/view/paint-layout.ts`, which serves both
the docs body (via `doc-canvas.ts`) and slides text boxes (via
`paintLayout`). Table cells and PDF export carry the same duplicated
formula but are an intentional follow-up (see below).

## Work

- [x] Store the line's tallest run size on the line.
  `LayoutLine.maxFontSizePx` in `layout.ts`, populated in
  `assignLineHeights` where `getLineMaxFontSizePx` already computes it.
  Optional field — non-text lines (table / HR / empty) constructed inline
  don't set it; painters fall back to the run's own size.
- [x] Use the line-max size for the base baseline in `renderRun`
  (`paint-layout.ts`). New `lineMaxFontSizePx?` param;
  `baselineY = round(lineY + (lineHeight + (lineMaxFontSizePx ?? originalFontSizePx) * 0.8) / 2)`.
  Super/subscript shifts intentionally stay keyed to the run's own size.
- [x] Thread the value through all three `renderRun` call sites:
  `paint-layout.ts` `paintBlock`, `doc-canvas.ts` body loop, and
  `doc-canvas.ts` `renderRunWithPageNumber` (header/footer).
- [x] Tests: `test/view/layout.test.ts` (field populated = tallest run,
  order-independent, uniform-line equals run size) +
  `test/view/paint-layout.test.ts` (mock ctx captures `baselineY`: mixed
  runs share it, tallest run unchanged when a small run joins, small run
  drops to the shared baseline, uniform line unchanged).
- [x] `@wafflebase/docs` typecheck + full test suite green (80 files);
  `@wafflebase/slides` typecheck + tests green (shared painter).

## Follow-up (out of scope for this branch)

Same `(lineHeight + fontSizePx * 0.8) / 2` formula, keyed to the run's own
size, needs the same fix for full parity:

- Table cells: `table-renderer.ts:467` (and marker `:558`)
- PDF export: `pdf-painter.ts:693` (and marker `:384`)
- On-screen list marker: `paint-layout.ts` `renderListMarker` still uses
  the marker's own size; would float next to a taller first line. Minor;
  can reuse `line.maxFontSizePx`.
