# Docs: resetting the font color paints the selection color (#728)

## Problem

In the docs editor, selecting text and clicking **Reset** in the text-color
picker leaves the text painted in the selection highlight color instead of
clearing the color.

Root cause — two layers:

1. The toolbar reset writes an **empty string** (`applyStyle({ color: "" })`)
   instead of clearing the key. `""` is a legal `string`, so
   `serializeInlineStyle` stores `color: ""` on the Yorkie Tree node and
   `defaultColorResolver` passes it through verbatim.
2. `paintRun` falls back with `??`, so `""` survives and
   `ctx.fillStyle = ""` is an **invalid** assignment — the Canvas spec says
   invalid color strings are ignored, so `fillStyle` keeps whatever the
   previous paint pass set. The selection rects are filled right before the
   run pass, so the text renders in `theme.selectionColor`.

## Plan

- [x] Toolbar reset clears the key: `applyStyle({ color: undefined })` /
      `{ backgroundColor: undefined }`. The Yorkie store already turns an
      explicitly-`undefined` key into `removeStyleByPath`
      (`removedInlineStyleAttrs`), so the attribute really leaves the CRDT.
      - [x] `components/text-formatting/text-format-group.tsx` (shared docs +
            slides toolbar)
      - [x] `app/docs/docs-formatting-toolbar.tsx` (slim/mobile toolbar)
- [x] Renderer treats a falsy resolved color as unset, so documents already
      saved with `color: ""` (and slides decks, which paint through the same
      docs `paintRun`) render with the theme default instead of a stale
      `fillStyle`. One shared helper, `resolveStoredColor(resolve, c)` in
      `model/color.ts`, normalizes `""` on **both** sides of the resolver —
      before, so a theme-aware resolver takes its "no color set" branch and
      returns the deck theme's text color (normalizing only after would paint
      a cleared run in the docs default on a dark deck); after, so a resolver
      that itself yields `""` never reaches `ctx.fillStyle`. Call sites:
      - [x] `paintRun` text color (and `underlineColor`, same shape)
      - [x] `renderListMarker` marker color
      - [x] `resolveColorAtPosition` (caret color tracks the run color)
      - [x] `table-renderer.ts` cell text + in-cell list markers — table
            blocks never pass through `paintRun` (paint-layout skips
            `block.type === 'table'`; the table renderer sets its own
            `ctx.font` / `ctx.fillStyle`), so text inside a table needed the
            same guard explicitly
- [x] DOCX export normalizes the resolved color into a valid `ST_HexColor`
      before writing `<w:color>` / `<w:shd w:fill>` (`toDocxHexColor` in
      `export/docx-style-map.ts`). `InlineStyle.color` and `CellStyle`
      `backgroundColor` can legitimately hold an arbitrary string (DOCX/PPTX
      import, HTML paste's `rgb(…)`, the legacy `''`), which emitted verbatim
      is both OOXML attribute injection and a schema-invalid attribute. The
      recognized CSS forms convert; anything else drops the attribute.
      Applied to **both** sinks — the run properties and the table cell fill
      in `export/docx-exporter.ts`, which writes the same attribute
- [x] PPTX export adopts the same "`''` means unset" convention (`hasColor`
      in `export/pptx/text.ts`): since there is no migration, decks keep
      `color: ""` forever, and `<a:srgbClr val=""/>` is an invalid
      `ST_HexColorRGB` that PowerPoint rejects. Covers run color, highlight,
      underline fill and the bullet marker color
- [x] Tests
      - [x] docs: `paint-layout.test.ts` — a run with `color: ''` paints the
            theme default, never the previously set `fillStyle`
      - [x] docs: `render-list-marker.test.ts` — `marker.color: ''` /
            `inline.color: ''` paint the theme default, and the resolver sees
            `undefined` (not `''`) so themes still apply
      - [x] docs: `color.test.ts` — `resolveColorAtPosition` falls back for
            `''` on both the covering-inline and trailing-inline branches;
            `resolveStoredColor` unit cases
      - [x] docs: `table-renderer.test.ts` — cell text and in-cell list
            marker with `color: ''` paint the theme default, not the
            pre-loaded selection fill
      - [x] docs: `paint-layout.test.ts` — `underlineColor: ''` strokes the
            run's text color (theme default when the run has none), and an
            explicit `underlineColor` still wins
      - [x] docs: `docx-style-map.test.ts` — hostile / non-hex color and
            backgroundColor values drop the attribute; `toDocxHexColor`
            unit cases (hex forms, `rgb()`/`rgba()`, rejects)
      - [x] docs: `docx-exporter.test.ts` — a table cell background
            normalizes into `<w:shd w:fill>`, a hostile one emits nothing
      - [x] slides: `export/pptx/text.test.ts` — `''` color / background /
            underline color emit no color children
      - [x] frontend: reset calls `applyStyle` with `color: undefined`

## Acceptance criteria (from the issue)

- Type text, select it, reset the text color → the text is uncolored
  (default ink), not the selection color.

## Non-goals

- No change to the color palette, picker UI, or the highlight-color rendering
  path (highlight already short-circuits on a falsy value).
- No migration pass over existing documents — the renderer guard makes
  already-stored `""` values render correctly, and the next reset removes them.
