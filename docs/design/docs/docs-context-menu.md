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
  (so nothing-to-offer right-clicks show neither an overlay nor the native
  menu). Async suggestions are guarded by a generation ref bumped on every
  open. Lifecycle (outside-mousedown + Escape close, `offsetWidth/Height`
  viewport clamp) mirrors `DocsTableContextMenu`.

### Read-only

Per-entry gating, not a whole-menu one:

| Entry | Shown when |
|-------|------------|
| Spell suggestions | Editable **and** a misspelling is under the pointer |
| Cut | Editable **and** a text selection |
| **Copy** | **A text selection — read-only included** |
| Paste | Editable |
| Add link / Add comment | Editable |

Copy is deliberately *not* gated on `!readOnly`. A read-only editor still
constructs its `TextEditor` and hidden textarea, so `editor.copy()` works
there — the same reason `handleKeyDown` lets plain Cmd/Ctrl+C through in
read-only mode. A viewer right-clicking a text selection therefore gets a
one-entry clipboard group; with no selection every group is empty and the
menu does not open at all.

The gate is `getActiveSelection()`, which is a **text** selection. A
click-selected image is view-local state the menu does not read, so the
menu never offers Copy for an image in either mode — a viewer copies an
image with Cmd/Ctrl+C after clicking it (see
[docs-image-editing.md](docs-image-editing.md)). Wiring an image selection
into this gate is a straightforward follow-up and deliberately not part of
the read-only Copy change.

## Risks and Mitigation

- **Programmatic paste is browser-limited** — accepted as best-effort;
  ⌘V remains the full-fidelity path.
- **Two overlays** (`DocsContextMenu` + `DocsTableContextMenu`) — kept
  mutually exclusive by the `isInTable()` bail; tables aren't spell-checked
  so no suggestions are lost.
- **Empty-overlay regression** — guarded by the compute-then-open check.
