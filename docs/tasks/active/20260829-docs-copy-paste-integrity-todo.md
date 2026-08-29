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

### Third review round (PR #984)

Behaviour this time, not only coverage. Four defects the verifier confirmed,
plus the small ones worth taking:

- **`deleteSelectedImageInline` deleted blind.** It ran
  `doc.deleteText({ blockId, offset }, 1)` on the *stored* selection without
  re-validating it. A peer who deleted the block made it throw; a peer who
  only shifted the text left the offset naming an ordinary character, and the
  keystroke ate that character instead — `ab<img>cd` became `abd`. It now
  re-validates with `findBlock` + `findImageAtOffset`, exactly as
  `imageSelectionProvider` does, and clears the stale selection instead.
- **A text cut left a stale image selection.** Both selections can be live;
  the text path wins and deletes text, shifting the offsets the image
  selection is measured in. `handleCut` now calls a new
  `imageSelectionClearer` hook before deleting. `handleCopy` was checked and
  needs no equivalent — it mutates nothing, so no offset moves under it.
- **Clicking an image never focused the hidden textarea.** The image mousedown
  path stops propagation before `TextEditor.handleMouseDown` can focus, and a
  read-only editor never focuses on mount, so on a read-only document the
  #870 path received neither the keydown nor the `copy` event — the context
  menu offered a Copy that did nothing. Both selection entry points now go
  through one `selectImageInline()` that focuses.
- **Nothing asserted the keydown is not cancelled.** The fix depends on
  `imageKeyHandler` consuming Cmd/Ctrl+C *without* `preventDefault()`, but the
  suite dispatched the keydown and the clipboard event independently, so
  adding one would have left every test green. Both C and X now assert
  `defaultPrevented === false`.
- The mod-key check keyed on `navigator.platform`, which is an empty string in
  some browsers — it picks the wrong modifier there and the shortcut falls
  into the catch-all that reintroduces #870. Now `e.metaKey || e.ctrlKey`.
  This reverses the previous round's "matches the existing idiom" call: the
  idiom itself is unsafe here, and accepting either modifier costs nothing
  because the branch only declines to clear the selection.
- `handleCopy` / `handleCut` called `preventDefault()` before knowing
  `e.clipboardData` was writable. Both now bail first — for cut that is also
  a data-loss guard, since it would otherwise delete content that reached no
  clipboard.
- New coverage for the two untested consumers the review named: **cut inside
  a table cell** (the other consumer of the rewritten `getSelectedBlocks`)
  and **copying a click-selected image in a read-only document**.

All 34 cases in `copy-integrity.test.ts` were mutation-checked by script:
each guard reverted in turn, the suite run, and the expected case confirmed
red. Every one was caught.

Still not done, unchanged from the last round: the `model/range-slices.ts`
re-base (deliberately not nested-table-aware, so it would reintroduce #872
one level deeper), and extending #872 to the header/footer edit context.
`getSelectedImage` / `updateSelectedImage` still call the throwing
`doc.getBlock()`; they are pre-existing siblings that finding 1's fix did not
touch, and are left for a separate change.

### Fourth review round (PR #984)

The verifier found the round-3 fix did not work in a real browser, and two
consequences of it that had been asserted rather than checked.

- **The #870 fix never ran in a browser.** `imageKeyHandler`'s catch-all
  cleared the image selection for any unrecognised key — including the
  *modifier's own keydown*. A real keyboard sends `{key:'Meta',
  metaKey:true}` first and the `c` only after, so the selection was already
  gone by the time the shortcut arrived. The whole suite missed it because
  every test synthesized a single combined `{key:'c', metaKey:true}` event,
  which no browser produces. `Meta`/`Control`/`Shift`/`Alt`/`AltGraph`/`OS`
  now return `false` without clearing, and the new tests dispatch the real
  two-event sequence.
- **The catch-all cleared without repainting.** For a key `TextEditor` then
  ignores, nothing else rendered, so the selection overlay stayed painted
  over state that was gone. It now renders before falling through.
- **The read-only copy flow was unreachable.** `handleImageMouseDown`
  returned early on `readOnly` and nothing in production calls
  `selectImageAt`, so a viewer could never select an image — which made the
  round-3 focus call, its design-doc paragraph, and the read-only test
  (which drove `selectImageAt`, not the mousedown) all describe a flow that
  could not happen. Selecting is not a mutation and every write it can reach
  is separately `readOnly`-guarded, so click-select is now allowed; the
  resize-handle branch and the hover cursor stay gated, and the overlay
  draws its border **without** the eight handles, which would otherwise
  misdescribe the document's permissions (`drawImageSelection` takes the
  mount's `readOnly` from `DocCanvas`).
- **`imageSelectionClearer` was wired to one path only.** Every other
  offset-shifting entry point left the same stale selection. One
  `clearImageSelectionForMutation()` helper now owns the rule: `TextEditor`
  reaches it for cut and for every paste (through `applyPastePlan`, the
  funnel all paste paths share), and the programmatic
  `applySpellSuggestion` / `insertTable` / `insertImage` /
  `insertPageNumber` APIs call it directly — none of those is preceded by a
  keydown, so the catch-all above would never have covered them.
- `selectImageInline` focused the hidden textarea before the caret render
  repositioned it, so the browser could scroll the container to the
  textarea's stale fixed position. The render now runs first.
- `writeImageToClipboard` wrote the Object Replacement Character as a
  literal glyph; now `'￼'` like the rest of the package.
- Docs: `docs-image-editing.md` rewritten for the bare-modifier guard,
  read-only selection and the clearing rule; `docs-context-menu.md` gained
  the per-entry read-only table it was missing; the #872 half of this PR is
  now recorded in `tables/docs-table-copy-paste.md`, its canonical home.

### Known coverage gap

Read-only image selection was opened up by removing `handleImageMouseDown`'s
top-level `readOnly` return, which means the pointer *resize* path is now
reachable in read-only up to the point where the handle branch declines it.
That gate is the only thing stopping a viewer from resizing — the resize
commit carries no `readOnly` check of its own. The shipped suite exercises
read-only selection through `selectImageAt`, not through a handle drag, so
the gate itself is unpinned: removing it would not turn any test red.

Testing it needs the jsdom geometry the hit-test reads (layout width from
`container.parentElement`, hit-test width from the canvas, both stubbed
before `initialize` picks its zoom scale) — machinery this suite does not
have. Worth adding; recorded here rather than claimed as covered.

Deliberately not done: `getSelectedImage` / `updateSelectedImage` still call
the throwing `doc.getBlock()` (a *remote* deletion still reaches them, so
hardening them stays a separate change), and the context menu still offers
Copy only for a text selection — wiring it would add a production caller of
exactly that unhardened path.
