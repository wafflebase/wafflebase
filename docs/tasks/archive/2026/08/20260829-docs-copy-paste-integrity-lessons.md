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

## A stored `{ blockId, offset }` is a guess, not a handle

Every consumer of the image selection has to re-derive it. The provider
learned that in round two (`findBlock`, not the throwing `getBlock`); the
*deleter* had not, and it is the one that matters most — a read that
resolves wrongly returns nothing, but a positional `deleteText` that
resolves wrongly deletes a real character the user never selected.
`ab<img>cd` with the image gone under it became `abd`.

The rule the code now follows: any path that acts on `selectedImage`
re-validates with `findBlock` + `findImageAtOffset` first, and treats a
failed lookup as "the selection is stale, drop it".

The corollary is the second finding: whoever *shifts* the offsets has to
clear the selection. `handleCut`'s text branch deletes text out from under
an image selection that can legitimately be live at the same time. Clearing
after the fact is not enough — the stale selection names whatever inline
landed on that offset, so the very next Delete removes the wrong image.

## Focus is part of "selected", not a side effect of clicking

The Cmd/Ctrl+C fix reached the keyboard through the hidden textarea, and
nothing focused it: the image mousedown handler stops propagation before
`TextEditor.handleMouseDown` runs, and a read-only editor deliberately never
focuses on mount. So the fix worked in exactly the case that was already
working (an editable document the user had typed in) and not in the one the
context-menu change was added for.

Two selection entry points had drifted apart — the mousedown hit-test and
the `selectImageAt` API each set `selectedImage` themselves. Routing both
through one `selectImageInline()` is what let a single jsdom test cover the
production path.

## A platform check that can return the empty string is a coin flip

`/Mac|iPhone|iPad|iPod/.test(navigator.platform)` reads as "is this a Mac",
but `navigator.platform` is deprecated and empty in some browsers — jsdom
included, which is how a test caught it. Empty means "not a Mac", so a real
Mac user gets the Ctrl branch and Cmd+C misses the guard.

Where a wrong answer is a *bug* and accepting both answers is harmless,
accept both: `e.metaKey || e.ctrlKey`. Round two had declined this same
change for consistency with the surrounding idiom. Consistency with an
unsafe idiom is not a reason.

## `preventDefault()` is a promise you can only keep after checking

`handleCopy`/`handleCut` cancelled the event and *then* wrote through
`e.clipboardData?.setData` — optional chaining, so a null clipboard was
silently a no-op. The user gets the worst of both: the browser's own copy
suppressed, nothing written, system clipboard emptied. For cut it was
worse still, because the deletion ran anyway.

Read the capability first, bail before claiming the event, and bind it to a
local (`const clipboard = e.clipboardData`) so the optional chaining that
hid the problem cannot come back.

## Process notes (round three)

- **Never `git checkout -- <file>` to undo a mutation experiment.** It
  reverts to HEAD, so it took the uncommitted fix with it. Snapshot the file
  contents in the mutation script and write them back in a `finally`, which
  is what the script does for every other mutation.
- Mutation-checking by hand does not scale past three or four guards. A
  small script that applies each mutation, runs the suite with
  `--reporter=json`, collects the failed titles and restores the file made
  seven checks cheap enough to re-run after the accident above.

## Synthesize the event *sequence*, not the event

Every shortcut test in this suite dispatched one `{key:'c', metaKey:true}`
keydown. No browser produces that on its own: it sends the modifier's own
keydown first (`key:'Meta'`, `metaKey:true`), then the letter while it is
held. A catch-all that cleared state for "any unrecognised key" therefore
fired on the *modifier*, wiping the image selection before the letter ever
arrived — issue #870, never actually fixed, with 34 green tests over it.

A combined-modifier keydown is a test-only artefact. Where a handler
branches on modifier state, at least one test has to press the modifier as
its own event, or the suite is asserting against an input the product never
receives.

## "Justified by a flow that cannot run" is a reviewable defect

Round three added a `focus()` call, a design-doc paragraph and a read-only
test, all resting on a viewer click-selecting an image. The mousedown
handler returned early on `readOnly` and nothing in production called
`selectImageAt`, so that click was impossible — and the test passed only
because it drove `selectImageAt` directly, the one caller that did not
exist in production.

Two habits close this: when a test needs a non-production entry point to
reach the code, ask *why* production cannot reach it; and grep the whole
repo for a public API's callers before writing prose that assumes it has
one. `selectImageAt` had exactly one caller — this test file.

## Prefer the chokepoint the invariant already passes through

Coordinates into a document (`{blockId, offset}`) go stale on any edit.
Clearing them at each editing entry point is a promise that must be re-made
whenever an entry point is added — round three made it at one site (cut) and
four others (`paste`, `applySpellSuggestion`, `insertTable`,
`insertPageNumber`) kept the bug.

The undo snapshot turned out to be the chokepoint: every content edit takes
one before it writes, so wrapping it clears the selection once for the whole
surface. Finding a chokepoint is worth a few minutes of grep — here it also
*deleted* an interface (`TextEditor.imageSelectionClearer`) instead of
adding four call sites. Note what has to stay outside it: the paths that
*own* the state being cleared (delete / resize commit / update) keep calling
the raw snapshot, and saying so in a comment is what stops the next reader
from "fixing" the inconsistency.

## jsdom geometry has to be stubbed in pairs

Driving the real mousedown hit-test needed the editor's layout and its
pointer math to agree, and they read widths from *different* elements — the
container's parent for layout and caret pixels, the canvas for the image
hit-test. jsdom reports 0 for both, and 0 vs 0 is not agreement: the two
paths then compute different page-centering offsets (the caret said x=200,
the hit-test rect started at x=108), so no click could ever land.

Stub every element a coordinate path reads, to the *same* width, and stub
the viewport-measuring one **before** `initialize()` — the first render
picks the zoom-to-fit scale factor from it, and a zero width makes the whole
coordinate space degenerate. `querySelector('canvas')` is also not enough
when the editor mounts more than one canvas.
