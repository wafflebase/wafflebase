# Lessons — docs select-all-then-type undo (#1045)

## A store seam only helps the paths that call it

`DocStore.batch()` was designed for exactly this failure and shipped months
earlier, but only the named-style and link-run paths adopted it. The editing
paths that write *per block* — the ones that can actually exhaust a 50-entry
undo stack — never did. Adding a seam is half the work; auditing the call
sites that need it is the other half.

## Wrapping the primitive beats wrapping every caller

`deleteSelection()` has ~19 call sites. Batching inside the primitive makes
all of them at most one unit for free; only the handful that write *more*
after the delete (typing, paste, Enter, page break) then need an outer unit,
and nested batches short-circuit. Wrapping 19 call sites by hand would have
been a much larger diff with more places to get the boundary wrong.

## `saveSnapshot()` must stay outside the batch

It looks like part of the edit, and on `MemDocStore` it is. On
`YorkieDocStore` it also flushes the *pre-edit* caret and selection into
presence, which is what Yorkie captures as the reverse of the change's
`addToHistory` set. Inside an open batch `skipNonHistoryPresence()` drops that
write — so batching it would have silently made undo restore the post-edit
caret. The batch must open at `deleteSelection()`, never before it.

The review panel then found the other half of that rule: the ordering is free
on `YorkieDocStore` (its `snapshot()` is a no-op) but not on `MemDocStore`,
where `batch()` took its own checkpoint up front and every batched edit would
have cost a dead Cmd+Z in a slides text box or the demo app. Fixed in the
store rather than in the caller — `MemDocStore.batch()` adopts a checkpoint
holding exactly the current state instead of pushing an identical second one
— because the two stores have to keep one contract, and only the store knows
what its own checkpoints mean.

## Holding a render holds the layout with it

The paint can wait for the batch to commit; `getLayout()` cannot. `render()`
is `recomputeLayout(); paint();`, so swallowing an interior `requestRender()`
also swallows the re-measure, and the rest of the unit keeps reading a
`blockParentMap` from before the delete — which the paste path branches on
(`isInCell` / `getCellInfo`). The fix was to split the seam: a held render
still calls the host's new `requestLayoutRefresh()`. "Keep rendering out of
the batch" is really two rules wearing one name.

## A depth is the wrong handle on a stack that drops from the bottom

`undoFloor` was a length. `pushUndo` `shift()`s the oldest entry once the
stack hits 50, so a length compared against a length recorded earlier stops
describing the same boundary. Holding the floor entry's *identity* and asking
where it is now (or whether it is gone) survives the drop; a number cannot.

## Making a fact live invalidates every reader that captured it

Re-resolving the share link on an interval turned `role` from a load-time
fact into a live one. `docs-view` was updated with it, but `readOnly` is read
at mount by five editors, and two of them — `slides-view` and `notes-view` —
still captured it once. `slides-view` even carried a comment asserting the
very assumption the change removed ("fixed for the lifetime of the route"),
so the next reader would have been told the opposite of the truth. Round 9's
Correctness and Design-fit lenses both landed on it; both were CONFIRMED and
both are one fix: list `readOnlyMount` / `readOnly` in the mount-effect deps
(the pattern `docs-view`, `board-view` and `sheet-view` already use) and
rewrite the stale comment. Covered by
`src/app/slides/slides-view-readonly.test.tsx` and
`src/app/notes/notes-view-readonly.test.tsx`, which mount each view over a
local Yorkie document with the engine's `initialize` spied on, and assert
both directions: a `false → true` flip rebuilds, an unrelated prop change
does not.

Widening a value's lifetime is not a local edit. The audit is "who reads
this, and when do they read it" — one grep per consumer, not one per caller
of the thing that changed.

Deliberately left undone, and why: mobile slides already reacts (it takes
`mode`, listed in its own deps), and the owning routes never pass `readOnly`
at all, so only the `/shared/:token` mounts change behavior. `YorkieNoteStore`
has no `dispose()`, so a notes rebuild leaves the constructor's `doc.subscribe`
attached — unlike the docs store's, that handler only snapshots a selection
onto the discarded store and drives no editor, so it is inert rather than
harmful. Adding a store API plus its tests for a bounded, once-per-downgrade
leak belongs to its own change, not to this one. The round's other two
blocking entries were `[POOL_EXHAUSTED]` infrastructure failures, not
findings; the non-blocking suggestions (sharing.md revalidation contract, the
undisposed store in the import path, polling after the error page, tests for
the revalidation query) were left alone to stop this PR growing further.

Both of those deferrals came back in round 13 and both were right to come
back — see the next two sections.

## Deferring a class of defect is no defence when the fix is on the branch

Round 13's blocking finding was that the toolbar's `applyBlockStyle` /
`toggleList` / `indent` / `outdent`, the two cell-rectangle writers, and
`FindReplaceState.replaceAll()` still wrote once per block outside any batch,
so "Tab is one undo unit, the Increase-indent button is a hundred" was the
shipped behaviour — the same action, the same selection, different verdict
depending on which control the user reached for. The branch's own design-doc
text *said so* and pointed at #1048, and that is what made it worse rather
than better: the divergence did not exist before this change, and the fix was
the wrapper already built here. Twelve of these are one line each plus a test.

The rule for next time: when a change fixes a class of defect on one code
path, enumerate the sibling paths *before* claiming the class. The audit that
found them is one grep (`forEachBlockInSelection`, then every `doc.` call
inside a loop), and the reachability check is one more (the toolbar component
that calls each `EditorAPI` member). Deferring is legitimate when the
follow-up is genuinely a different change; it is not when it is the same
three lines in the next function down.

What *did* stay deferred, with a reason that survives: the logic is still
written three times (`EditorAPI`, `TextEditor`, `text-box-editor`), and each
copy now carries its own `doc.batch(...)`. Routing them together looked like
the elegant move and is not behaviour-preserving — `TextEditor.toggleList()`
acts on the caret's block where the `EditorAPI` one acts on the selection, and
`textEditor` is absent on a read-only mount. A refactor that changes what a
button does is not a cleanup.

## A checkpoint is not an undo unit until something is written

`MemDocStore.snapshot()` pushed a copy of the current document onto the undo
stack. That reads as obviously correct and is not: a checkpoint holding
exactly the current state is a Cmd+Z that changes nothing unless a write
follows it, and an action that snapshots and then writes nothing is ordinary
(the indent button with every item at `MAX_LIST_LEVEL`, a Replace All with no
matches). Earlier in this same branch `snapshot()` also cleared redo, which
hid the first half of the bug by destroying the evidence; once redo was
correctly preserved, the dead checkpoint became a dead Cmd+Z followed by a
dead Cmd+Shift+Z with the real redo entry one press further away than it
looked.

The fix is to move the push to `willWrite()`, where the redo clear had
already been moved for the same reason — the write is the event, in both
directions. Two things fell out of it that were being paid for separately:

- `batch()`'s adoption of a preceding `snapshot()` had been a *value*
  heuristic (JSON-stringify the whole document, compare against the top of
  the undo stack). With the checkpoint deferred, adoption is reading a field,
  and one full-document stringify per batch — one per keystroke on the slides
  text-box and demo paths — goes away.
- `YorkieDocStore` answers "nothing to undo" for a write-nothing action by
  construction, because its `snapshot()` is a no-op. Deferring is what makes
  the in-memory store agree, so the parity the branch kept patching stopped
  needing patches.

The general shape: when two implementations of one interface keep needing
compensating hacks to agree, the interface is usually being read at the wrong
moment by one of them. Here `snapshot()` was being treated as the event when
the event was the write.

## Read the SDK before writing a comment about what the SDK might do

`canUndo()`'s undo-floor lookup had a branch commented "either the entry was
shifted off the bottom or the SDK rebuilt it in place", with a cap test to
tell them apart, and the panel flagged the residual case as a silent
permanent loss of the floor. The rebuilt case does not exist: in
`@yorkie-js/sdk` 0.7.20's `History`, `pushUndo` stores the caller's array by
reference, `getUndoStackForTest()` returns the live stack, and
`reconcileCreatedAt` / `reconcileTextEdit` mutate the *operations* inside an
entry without ever replacing the entry — and the one remaining way an entry
leaves the stack, `popUndo`, cannot reach the floor because `canUndo()` only
answers true with an entry above it. Fifteen minutes in `dist/` turned a
speculative fix into a grounded rejection plus an enumerated comment.

An honest "this cannot happen, here is why" is worth more than a guard for a
case nobody has characterized: the guard has to be maintained and it teaches
the next reader something false.

## "Identical to main" is not a defence when the branch's own doc says otherwise

Round 14's one code fix was a line byte-identical to `origin/main`, and two of
six verifiers refused it on exactly that ground. They were right about the
provenance and wrong about the verdict: this branch's design doc had just
started claiming *"The toolbar's paths are covered too, one by one"*, and that
sentence was false while `insertLink`'s plain arm was bare. A pre-existing line
becomes this PR's problem the moment the PR documents it as fixed. The rule is
not "fix everything you touch"; it is that a claim and the code have to agree,
and the cheap way to make them agree is usually the one-line fix rather than a
qualified sentence.

The severity still has to be stated accurately. A stranded `href` is
repairable — select the range, Remove link — where #1045 lost content
outright. Filing both at the same pitch is how a review loop stops being able
to tell which finding matters.

## A perf test needs to know what its own caches absorb

The first version of the `keepDirty` guard counted `measureText` calls after a
keystroke and passed identically with the option reverted — 12 either way. The
option was working; the *test* could not see it, because `layout.ts` memoizes
every (text, font) width process-wide, so the extra full pass re-walked all 40
blocks without measuring anything. Clearing the measure cache first turns the
same assertion into 58 against 216.

Two lessons, and the second is the load-bearing one. A guard for "we do less
work now" has to name the resource it is counting and check that nothing
between the code and the counter is holding the answer. And the check for that
is mechanical: revert the thing under test and watch the number move. A test
whose number does not move is not a weak test, it is not a test — which is
also what the panel found in the undo-floor identity case, where the whole
mocked-copy scenario fell through to the very fallback it was meant to be
distinguished from. Both were found the same way, by reverting the guard, and
both should have been found that way when they were written.

## A corrected comment needs the same verification as a corrected line

Round 14 rewrote `applyStyleToSelection`'s doc comment because the old text
claimed every caller snapshots. The replacement claimed that an unstaged write
"records no presence at all rather than a stale one" — and round 15 found that
one false too. `consumePendingCursor()` does clear on every *write*, so the
sentence holds for the case it was written against; what it misses is that
`saveSnapshot()` can be called on a path that then returns without writing
(`handleBackspace` at the first block of a table cell; a table border drag
under a pixel), leaving a staged position for whatever writes next to consume
as its reverse caret. Two rounds in a row, a comment correction traded one
overstatement for another.

The same round produced the same shape twice more. `pastePlainTextFromClipboard`
grew a `|| this.readOnly` re-check whose comment said `readOnly` is "re-read at
the moment of the write" — the field is assigned once in the constructor and
has no setter, so it is the same value the earlier gate saw, and the check that
actually catches a mid-prompt permission change is `this.disposed`. And
`insertLink`'s new comment pointed the reader at "the caret branch below for
why" when that branch documents a *presence* write held out of a batch, an
unrelated reason.

The rule this yields: a prose claim about mechanism is a claim, and it gets
checked the way a code change gets checked — find the field's assignments,
read the callee, follow the cross-reference to the line it names. The
comment-shaped version of "revert the guard and watch the number move" is
"assume the sentence is wrong and try to falsify it": grep the identifier it
names, and if the sentence survives that, write down the condition under which
it holds rather than the unconditional form. Every one of these three was
found in a few minutes of grep by a reader who did not trust the sentence,
which means the author could have found them in the same few minutes.

Corollary, and the cheaper habit: prefer the conditional phrasing at writing
time. "Usually nothing, and here is the exception" costs one clause and cannot
rot into a lie; "nothing at all" is a hostage to the next path someone adds.
