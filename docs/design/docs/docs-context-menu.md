---
title: docs-context-menu
target-version: 0.2.0
---

# Docs Unified Context Menu

## Summary

One Google-Docs-style right-click menu for the Docs editor body, replacing
the former standalone spell-suggestions popover and `DocsCommentContextMenu`.
Built as a plain positioned overlay in the frontend (`DocsContextMenu`,
`packages/frontend/src/app/docs/docs-context-menu.tsx`) — **not** Radix,
which blocks Canvas pointer events. In a table, `DocsTableContextMenu`
still handles right-click (distinct context; table text isn't spell-checked).

## Goals / Non-Goals

### Goals

- A single body-text menu, grouped with separators like Google Docs:
  1. **Spell suggestions** (only on a misspelled word; async).
  2. **Cut / Copy** (selection-gated) and **Paste** (best-effort).
  3. **Add link** (⌘K) / **Add comment** (⌘⌥M).
- Reuse existing backends; the Canvas never shows the browser's native menu.

### Non-Goals (v1)

- Select all, Ignore / Add-to-dictionary, Define, Smart chips, Format
  options, Building blocks (Google-specific / deferred).
- Folding the table menu in — it stays separate.

## Proposal Details

### Layering

- **Docs package** (`EditorAPI`) exposes the primitives the menu drives:
  - Spell: `getSpellErrorAt(clientX, clientY)`, `getSpellSuggestions(word)`,
    `applySpellSuggestion(err, replacement)` (see
    [docs-spell-check.md](docs-spell-check.md)).
  - Clipboard: `copy()` / `cut()` focus the hidden textarea and fire the
    existing rich `handleCopy`/`handleCut` via `execCommand`; `paste()` is
    best-effort — `navigator.clipboard.read()` → the shared paste parser
    (`pasteFromParts`, HTML/markdown/plain). The internal `WAFFLEDOCS_MIME`
    rich format is unavailable to the async Clipboard API (browser
    security), so menu-paste falls back to HTML/plain; keyboard ⌘V keeps
    the full internal path.
  - Insert: existing `requestLink()`; comments via the page's
    `comments.beginCompose()` (passed as `onInsertComment`).
  - `handleEditorContextMenu` always `preventDefault()`s — native menu
    suppression lives here regardless of the frontend menu.

- **Frontend** (`DocsContextMenu`): one `contextmenu` listener on the
  editor container. Bails when `editor.isInTable()`. Computes group
  visibility first and **returns without opening** if every group is empty
  (so read-only / nothing-to-offer right-clicks show neither an overlay
  nor the native menu). Async suggestions are guarded by a generation ref
  bumped on every open. Lifecycle (outside-mousedown + Escape close,
  `offsetWidth/Height` viewport clamp) mirrors `DocsTableContextMenu`.

## Risks and Mitigation

- **Programmatic paste is browser-limited** — accepted as best-effort;
  ⌘V remains the full-fidelity path.
- **Two overlays** (`DocsContextMenu` + `DocsTableContextMenu`) — kept
  mutually exclusive by the `isInTable()` bail; tables aren't spell-checked
  so no suggestions are lost.
- **Empty-overlay regression** — guarded by the compute-then-open check.
