# Docs copy/paste integrity (issues #872, #870, #478)

Three independent defects on the docs clipboard path. Two are on the **copy**
side (the payload the editor writes is empty or missing) and one is on the
**paste** side (a markdown payload is not recognised).

## Problem

### #872 — copying inside a table cell loses formatting and images

`getSelectedBlocks()` (`packages/docs/src/view/text-editor.ts`) resolved both
selection endpoints against `layout.blocks`, which holds **top-level** blocks
only. Cell content is a separate block list hanging off the table block, so a
selection anchored in a cell produced `findIndex === -1` for both endpoints and
the function returned `[]`. `handleCopy` then wrote an empty
`application/x-waffledocs` payload and the clipboard carried only `text/plain`
— every inline style and every image was dropped on paste.

`getSelectedText()` and `isInTable()` already resolve cell blocks through
`layout.blockParentMap`; the copy path simply never did.

### #870 — copying a click-selected image puts nothing on the clipboard

An image selected by clicking it is view-local state (`selectedImage` in
`packages/docs/src/view/editor.ts`), not a text `Selection`. Two things
followed from that:

1. `handleCopy` early-returned on `!this.selection.hasSelection()`.
2. `imageKeyHandler`'s catch-all branch cleared `selectedImage` for every key
   it did not recognise — including Cmd/Ctrl+C — so by the time the browser's
   `copy` event fired, even the view state was gone.

### #478 — pasted Markdown is not parsed

`parseMarkdownWithTables()` (`packages/docs/src/view/clipboard.ts`) only ever
returned blocks when a `|`-table with a separator row was present, and turned
every other line into an unstyled paragraph. Headings, lists, emphasis and
links pasted as literal `#`/`-`/`**`/`[…](…)` source text.

## Plan

1. **Cell-aware `getSelectedBlocks()`.** Look the start endpoint up in
   `layout.blockParentMap`; when it is in a cell, resolve the owning table with
   `resolveNestedTableLayout` (so nested tables work) and slice that cell's
   block list. Extract the existing clone/trim loop into `sliceBlockRange()`
   so the body and cell paths share one implementation.
   `normalizeRange` already guarantees both endpoints share one cell whenever
   either is in one, so the start's cell is the range's cell.
2. **Image-aware copy/cut.** Add `imageSelectionProvider` and
   `imageDeleteHandler` hooks on `TextEditor`; `editor.ts` supplies them from
   its own `selectedImage`. `handleCopy` / `handleCut` consult the provider
   when there is no text selection and write a one-inline paragraph — the same
   shape an in-document image copy already produces, so it pastes back through
   the ordinary payload path. `imageKeyHandler` consumes Cmd/Ctrl+C and
   Cmd/Ctrl+X **without** `preventDefault`, so the native clipboard event still
   fires while the image selection survives.
3. **Markdown paste.** Extend `parseMarkdownWithTables` to recognise headings,
   ordered/unordered lists, `**bold**` / `*italic*` / `` `code` `` and
   `[text](url)` links, mapping onto the existing `BlockType` / `InlineStyle`.
   Return `null` (fall through to plain text) only when the text contains no
   markdown construct at all, so a plain-text paste is unchanged.

## Acceptance criteria

- [x] Copying a styled range inside a table cell carries inline styles
- [x] Copying a range inside a table cell carries images
- [x] A cell copy trims to the selection boundaries, like a body copy
- [x] A cell copy spanning several blocks in one cell keeps each block's type
- [x] Cmd/Ctrl+C over a click-selected image does not drop the selection
- [x] Cmd/Ctrl+C over a click-selected image writes the image payload
- [x] That payload pastes back as a second image
- [x] A text selection still wins over an image selection
- [x] Read-only Copy is offered in the context menu (it always worked)
- [x] Pasted markdown headings become `heading` blocks at the right level
- [x] Pasted markdown lists become `list-item` blocks with the right kind/level
- [x] `**bold**`, `*italic*`, `` `code` ``, `[text](url)` become inline styles
- [x] Plain text with no markdown still falls through to the plain-text path
- [x] Existing markdown-table behaviour is unchanged

## Non-goals

- Code blocks (` ``` `) — `BlockType` has no `code-block`, so they stay plain
  text rather than growing the model.
- Thematic breaks (`---`), blockquotes, images (`![]()`), reference links,
  escapes (`\*`), and `_underscore_` emphasis — see the lessons file for why
  each was left out.
- Markdown's "consecutive lines join into one paragraph" rule; the parser keeps
  the pre-existing one-line-per-block shape.
- Cross-cell copy (selecting text in two different cells). `normalizeRange`
  refuses that range today; a whole-cell rectangle already has its own path
  (`getSelectedTableCells`).

## Review

Landed in two commits on `agent/docs-copy-paste-integrity`:

1. Copy path (#872 + #870) — `packages/docs/src/view/text-editor.ts`,
   `packages/docs/src/view/editor.ts`,
   `packages/frontend/src/app/docs/docs-context-menu.tsx`; tests in
   `packages/docs/test/view/copy-integrity.test.ts` and
   `packages/frontend/tests/app/docs/docs-context-menu.test.tsx`.
2. Paste path (#478) — `packages/docs/src/view/clipboard.ts`; tests in
   `packages/docs/test/view/markdown-paste.test.ts`.
