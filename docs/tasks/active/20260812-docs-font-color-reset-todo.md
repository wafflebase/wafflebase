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
      `fillStyle`:
      - [x] `paintRun` text color
      - [x] `renderListMarker` marker color
      - [x] `resolveColorAtPosition` (caret color tracks the run color)
- [x] Tests
      - [x] docs: `paint-layout.test.ts` — a run with `color: ''` paints the
            theme default, never the previously set `fillStyle`
      - [x] frontend: reset calls `applyStyle` with `color: undefined`

## Acceptance criteria (from the issue)

- Type text, select it, reset the text color → the text is uncolored
  (default ink), not the selection color.

## Non-goals

- No change to the color palette, picker UI, or the highlight-color rendering
  path (highlight already short-circuits on a falsy value).
- No migration pass over existing documents — the renderer guard makes
  already-stored `""` values render correctly, and the next reset removes them.
