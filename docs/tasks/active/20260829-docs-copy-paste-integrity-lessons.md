# Lessons — docs copy/paste integrity (#872, #870, #478)

## The cell-copy bug was a missing reuse, not missing logic

`getSelectedText()` and `isInTable()` already resolve table-cell blocks
through `layout.blockParentMap`; `getSelectedBlocks()` was the one reader that
still assumed `layout.blocks` held every block. That is why the symptom was so
lopsided — the `text/plain` flavour of a cell copy was always correct, while
the rich flavour was always empty. **When one flavour of an output is right
and its sibling is empty, look for two different lookups rather than one
broken transform.**

`normalizeRange` is what makes the fix a single lookup instead of two: it
already refuses any range whose endpoints are in different cells (or one in a
cell and one outside), so the start endpoint's `BlockCellInfo` describes the
whole range. Resolving the table with `resolveNestedTableLayout` rather than
`layout.blocks.find(...)` is the difference between working in a nested table
and not — `getSelectedText()` still uses the `find`, so it has the nested-table
hole this fix does not.

## View-local state is invisible to the handlers that need it

Issue #870 had *two* causes, and fixing either alone would have looked like it
did nothing:

1. `handleCopy` bailed on "no text selection".
2. `imageKeyHandler`'s catch-all cleared `selectedImage` for any key it did not
   name — including Cmd/Ctrl+C — so even the view state was gone by the time
   the browser fired `copy`.

The second is the interesting one. The handler is called *before*
`preventDefault` decisions are made, and returning `true` from it means
"consumed" without suppressing the browser's default action. So the copy
shortcut can be absorbed (protecting the selection) while the native clipboard
event still fires — which is exactly what the fix needs, and what makes it
unnecessary to re-implement copying with `navigator.clipboard`.

The image selection stays owned by `editor.ts`; `TextEditor` only gets a
reader (`imageSelectionProvider`) and a writer (`imageDeleteHandler`). That
follows the `imageKeyHandler` / `imageFilePasteHandler` precedent already in
the file rather than moving state across the boundary.

## `read-only copy is impossible` was folklore

`docs-context-menu.tsx` hid Copy in read-only mode with the comment "editor.
copy() uses the hidden textarea, which is null in read-only mode". It is not
null: `editor-read-only.test.ts` has been asserting since #482 that a
read-only editor still constructs its `TextEditor`, and that a `copy` event on
its textarea writes `text/plain`. `handleKeyDown` even has a comment
explaining that it deliberately lets ⌘C through in read-only. So keyboard copy
worked and only the menu entry was missing. **A comment that explains why
something is impossible is worth one grep against the code it describes.**

## Fixing the read-only Delete hole came free

`imageKeyHandler` runs *before* `handleKeyDown`'s `readOnly` early-return, so
Delete/Backspace on a click-selected image mutated a read-only document.
Extracting the removal into `deleteSelectedImageInline()` for cut's sake gave
one place to put the `if (readOnly) return;` guard, closing that for both
paths. (Cut itself was already safe — `handleCut` blocks read-only first.)

## Markdown: detection has to be conservative, parsing does not

The risk in #478 is not "does it parse markdown" but "does it mangle text that
merely *looks* like markdown". Two rules kept that bounded:

- **`parseMarkdownWithTables` still returns `null` when nothing markdown was
  found**, so a plain-text paste keeps the plain-text path (and its caret
  merge semantics) untouched. Only a text carrying at least one real construct
  becomes blocks.
- **Emphasis delimiters require non-space content.** `*(\S|\S[^*\n]*\S)*` is
  what stops `2 * 3 * 4` from turning "` 3 `" italic — the naive `\*([^*]+)\*`
  eats it. A test pins that exact string.

Deliberately left out, and why:

| Construct | Why not |
|---|---|
| Code blocks (` ``` `) | `BlockType` has no `code-block`; representing one would mean a model change, and the task explicitly ruled that out. |
| `_italic_` / `__bold__` | Underscore emphasis collides with `snake_case` identifiers. Once *any* line in the paste is markdown, every other line is inline-parsed, so a single heading would mangle identifiers elsewhere in the same paste. Asterisks have no such collision. |
| `---` thematic breaks | `MD_SEPARATOR_RE` already claims `---` as a table separator; giving it a second meaning needs lookbehind rules this parser does not have. |
| `![alt](url)` images | An `ImageData` needs width and height, which markdown does not carry. |
| Nested emphasis (`**a *b* c**`) | The scanner is single-pass and non-recursive; nesting would need a real inline parser. |
| Blockquotes, reference links, `\*` escapes | Same reason — out of the task's stated list. |

`` `code` `` maps to `fontFamily: 'Courier New'` rather than a new field.
That family is already first-class in the docs package (`MONOSPACE_FONTS` in
`view/fonts.ts` routes it to a monospace generic), so it renders, exports and
round-trips like any other font choice.

Link URLs go through `isSafeUrl` before becoming an `href`; an unsafe scheme
leaves the `[text](url)` as literal characters. The HTML paste path does *not*
do this today, which is a gap worth a separate look — it was left alone here
because widening it would have put an unrelated behaviour change in this
branch.

## Process notes

- **`pnpm verify:fast 2>&1 | tail -40` reports `tail`'s exit code, not the
  run's.** The first run "passed" with exit 0 while the log ended in
  `Exit status 2`. Redirect to a file and echo `$?` instead.
- That real failure was `@wafflebase/slides/node` missing — the CLI typechecks
  against slides' built `dist`. A worktree needs `core`, `docs` **and**
  `slides` built before `verify:fast` is meaningful, not just the first two.
- A test file written for the *next* commit must be parked outside the repo
  while verifying the current one, or `verify:fast` fails on a bug that has
  not been fixed yet.
