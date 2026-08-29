# Docs copy integrity (issues #872, #870)

Two independent defects on the docs **copy** path: the payload the editor
writes is empty or missing. A third issue (#478, markdown paste) was attempted
here and deliberately withdrawn — see "Withdrawn: #478" below.

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

## Acceptance criteria

- [x] Copying a styled range inside a table cell carries inline styles
- [x] Copying a range inside a table cell carries images
- [x] A cell copy trims to the selection boundaries, like a body copy
- [x] A cell copy spanning several blocks in one cell keeps each block's type
- [x] Cmd/Ctrl+C over a click-selected image does not drop the selection
- [x] Cmd/Ctrl+C over a click-selected image writes the image payload
- [x] That payload pastes back as a second image
- [x] A text selection still wins over an image selection
- [x] Caps Lock does not drop the image selection (review finding)
- [x] Read-only Copy is offered in the context menu (it always worked)

## Non-goals

- Cross-cell copy (selecting text in two different cells). `normalizeRange`
  refuses that range today; a whole-cell rectangle already has its own path
  (`getSelectedTableCells`).

## Withdrawn: #478 (markdown paste)

A markdown-paste parser was implemented on this branch and **removed before
the PR**. Code review reproduced two defects that a regex pass cannot close,
so the work is refiled rather than half-landed. Findings, all reproduced
against the implementation:

1. **Text corruption in the modal use case.** The italic alternative
   `\*(\S|\S[^*\n]*\S)\*` uses `\S`, which matches `*` itself, so it pairs a
   `*` from one token with a `*` from the next and *deletes* both:

   ```
   # API                        heading   | API
   def f(*args, **kwargs):  →   paragraph | def f(args, *kwargs):
   return a*b*c                 paragraph | return abc
   ```

   The trigger is a single `# ` heading anywhere in the paste, so pasting a
   README or an LLM answer containing a code snippet corrupts it. This was a
   regression: before the change, no `|`-table meant `null` and the whole
   paste took the plain-text path intact.

2. **Quadratic backtracking.** The link alternative
   `\[([^\]\n]+)\]\(([^()\s]+)\)` scans to the next `]` and backtracks per `[`.
   Measured on this branch: `'['.repeat(n)` on one line costs 0.6 s at
   n=16,000, 3.3 s at 32,000, 6.7 s at 64,000 — and returns `null`, so the
   whole cost buys a plain-text paste. `LARGE_PASTE_WEIGHT_THRESHOLD` does not
   help: it paints a toast and runs the same synchronous job, with no cancel.

3. Any `<digits>. ` line start becomes an ordered list item and eats the
   number, so a pasted bibliography (`2020. On things.`) loses its year *and*
   drags the whole paste onto the markdown path.

4. No backslash-escape handling, so this app's own markdown export does not
   round-trip through its paste path.

The root gap is structural, not regex-level: there is **no code-fence
handling**, and there cannot be until `BlockType` gains `code-block`
(roadmap 3.3, not started). Inline parsing must not run inside a fence. A
redo should decide the fence question first, then follow CommonMark's
delimiter-run rules for emphasis and its "ordered lists may only interrupt a
paragraph at 1" rule, and bound or restructure the link scan.

## Review

Landed as one commit on `agent/docs-copy-paste-integrity` —
`packages/docs/src/view/text-editor.ts`, `packages/docs/src/view/editor.ts`,
`packages/frontend/src/app/docs/docs-context-menu.tsx`; tests in
`packages/docs/test/view/copy-integrity.test.ts` and
`packages/frontend/tests/app/docs/docs-context-menu.test.tsx`.

Two blocking review findings were applied on top:

- `imageKeyHandler` compared the raw `e.key`, so **Caps Lock** made Cmd/Ctrl+C
  arrive as `'C'`, miss the guard, and fall into the catch-all that clears the
  selection — silently reintroducing #870. Normalized the same way
  `TextEditor.handleKeyDown` does, and pinned with a test that fails without
  the fix.
- `imageSelectionProvider` called `doc.getBlock()`, which **throws** (the
  non-throwing variant is `findBlock`), making the `if (!block)` line dead. It
  runs inside the browser's `copy` listener before `preventDefault()`, so a
  block a remote peer had just deleted would throw out of the listener and let
  the default copy wipe the user's system clipboard.

### Second review round (PR #984)

Coverage-only, plus the design doc. No behaviour changed — every branch the
review named already worked; what was missing was a test that would notice
if it stopped. `packages/docs/test/view/copy-integrity.test.ts` grew from 8
to 21 cases:

- The whole **cut** path (payload parity with copy, the removal, the caret
  landing where the image was, one undo unit, the Caps Lock `'X'` variant,
  and the read-only refusal) — previously the only document-mutating branch
  in the diff with no test at all.
- **`deleteSelectedImageInline`**, including its read-only early return.
  `imageKeyHandler` is consulted before `handleKeyDown`'s read-only guard,
  so that early return is the only thing stopping Delete from mutating a
  read-only document.
- The **nested-table** cell resolution `resolveNestedTableLayout` exists for.
  Every earlier table case used a top-level table, which `layout.blocks`
  alone would have resolved.
- `imageSelectionProvider`'s two null guards, driven the way production
  does it: mutate the store as a peer would, then `getDoc().refresh()` —
  the exact pair `docs-view.tsx`'s `store.onRemoteChange` performs.
- `writeImageToClipboard`'s `text/plain` flavour, with and without alt text.
- The precedence case named "an image selection is ignored when there is
  also a text selection" **never selected an image**, so it asserted nothing
  about precedence and would have passed under the inverted rule. It now
  establishes both selections and asserts the text one wins.

Every new assertion was mutation-checked: each guard was reverted in turn
and the run confirmed to fail. That found one weak spot worth keeping — a
DOM listener's exception never reaches the dispatcher, so restoring the
throwing `doc.getBlock()` left all 21 tests "passing" with only an
out-of-band unhandled error. `dispatchClipboard` now captures listener
throws off the `window` `error` event and asserts on them.

Not done, deliberately (argued in the PR thread): re-basing the cell
traversal on `model/range-slices.ts` (doc-based and deliberately *not*
nested-table-aware, unlike this layout-based path), image support in the
context menu's Copy/Cut (a real gap, but a separate change), and
refactoring the inlined mod-key detection (it matches the existing idiom
at `text-editor.ts:858`).

Docs: `docs/design/docs/docs-image-editing.md` now documents the copy/cut
keys, the read-only ordering hazard, the key normalization, and the two
`TextEditor` hooks. Its arrow-key rows claimed a 1px/8px resize nudge that
has never been implemented — the shipped handler deselects and moves the
caret — so they were corrected to match the code.
