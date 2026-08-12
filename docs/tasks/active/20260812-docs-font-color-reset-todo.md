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
- [x] DOCX export escapes the resolved color into `<w:color>` / `<w:shd>`
      with the `escapeXmlAttr` already applied to `fontFamily` in the same
      element — `InlineStyle.color` can legitimately hold an arbitrary
      string, which unescaped is OOXML attribute injection
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
      - [x] docs: `docx-style-map.test.ts` — hostile color / backgroundColor
            values are escaped in the run properties XML
      - [x] frontend: reset calls `applyStyle` with `color: undefined`

## Acceptance criteria (from the issue)

- Type text, select it, reset the text color → the text is uncolored
  (default ink), not the selection color.

## Non-goals

- No change to the color palette, picker UI, or the highlight-color rendering
  path (highlight already short-circuits on a falsy value).
- No migration pass over existing documents — the renderer guard makes
  already-stored `""` values render correctly, and the next reset removes them.
