# Lessons — docs `DocStore.batch()` seam

## The design docs already contained the design

`docs-font-controls.md` named the missing seam, named the store that
already had one, and named the two follow-ups it would unblock.
`slides-native-undo.md` had the implementation, including the two
non-obvious parts (how nested calls short-circuit, and the fact that
reads inside an open `doc.update` are safe). Reading both before touching
code turned this from a design task into a transcription task. The repo's
"a deferral must say what unblocks it" convention paid for itself here.

Transcription, not copying: the slides sketch short-circuits nested batches
on a depth counter, and `YorkieDocStore` keys on `activeRoot` instead. A
counter stays raised through the SDK's post-updater work (change push, the
synchronous `local-change` publish) — which runs after the ambient root is
gone — so a subscriber re-entering `batch()` there would take the nested fast
path with no root to write into. Keying on the sentinel `withUpdate` already
reads makes the two impossible to disagree. `MemDocStore` does use a counter,
because its undo unit is anchored to `snapshot()` and there is no root.

## Verify the SDK claim the seam rests on, don't infer it

The whole design rests on "one `doc.update()` = one undo unit, and there is
no cross-update grouping API". `slides-native-undo.md` asserts it for
`@yorkie-js/sdk` 0.7.8; this worktree runs 0.7.17. Reading the shipped
`dist/yorkie-js-sdk.es.js` took two minutes and answered three questions
the design needed:

- `update()` sets an `isUpdating` flag and builds its change from one
  `ChangeContext`. A nested `update()` would push a second change while
  the outer one is open **and** clear `isUpdating` early — so routing
  *every* write through `withUpdate` is a correctness requirement, not
  tidiness. That is why all 30 call sites had to move, not just the ones
  the named-style path reaches.
- `getRoot()` calls `ensureClone()` and builds its context over the *same*
  `clone.root` the open update is mutating. Reads inside a batch therefore
  observe in-progress writes — which is what makes `dropStaleStyleOffAll`
  (which re-reads the store between the two writes) work inside a batch at
  all. Writes through that proxy would be silently dropped; the store only
  reads there.
- `history.canUndo()` is false while `isUpdating`, so `undo()` inside a
  batch is already a safe no-op and needed no new guard.

Lesson: when a design doc states an upstream invariant, re-derive it from
the version actually installed. Three of the four decisions above would
otherwise have been guesses.

## "One undo unit" means different things in different stores

`MemDocStore`'s undo unit is anchored to `snapshot()`; `YorkieDocStore`'s is
anchored to `doc.update()`. Writing `batch()` once and expecting both to
inherit the behaviour would have produced a Mem store where a batch is N
undo units. The interface had to document the **contract** (one batch = one
unit, nested calls don't nest) and let each store reach it its own way — Mem
by suppressing repeat `snapshot()` calls, Yorkie by opening one update.

Corollary for the tests: the Mem tests and the Yorkie tests assert the same
property through different observables (`canUndo()` transitions vs
`getUndoStackForTest().length`). Neither can substitute for the other.

## A new grouping primitive needs a boundary test, not just a grouping test

The failing test the task asked for proves `batch()` collapses two writes.
It cannot fail if `batch()` collapses *everything* — including two genuinely
separate user actions, which would be a worse bug than the one being fixed.
Slides guards this with a churn regression test; docs has no such harness.
Two cheap boundary tests cover the same risk directly: unbatched consecutive
writes stay separate undo units, and two batches stay two undo units. Both
passed before the change, which is exactly what makes them useful — they
pin behaviour the change must *not* alter.

The other thing that keeps the risk small is that `batch()` is opt-in: four
call sites call it, and every other editing path keeps exactly the undo
granularity it had. "Untouched" would overstate it — all 30 `doc.update`
call sites in `YorkieDocStore` were rerouted through `withUpdate`, because a
nested update inside an open batch would split the batch's undo unit. Outside
a batch `withUpdate` opens the same standalone `doc.update` those call sites
opened before, so the granularity is unchanged; the code is not. Worth
stating precisely in the design doc, because "we added a batching primitive"
reads much scarier than "we added a primitive, called it four times, and
routed every writer through one helper so it can be honoured".

## Keep paint outside the transaction

The obvious refactor was to wrap the existing `afterNamedStyleChange()` tail
in `batch()`. That would have put `render()` inside an open `doc.update`.
Splitting the helper so the batch contains only the store writes, and
layout/paint run after it commits, is both more correct and clearer about
what the transaction boundary is. `withNamedStyleChange(write)` taking the
registry write as a callback makes that boundary structural instead of a
convention four call sites have to remember.

## Test-file placement is a load-bearing comment

`editor-undo-selection.test.ts` carries a comment explaining that its two
describes live in one file *deliberately*: mounting the docs editor pulls in
the whole `@wafflebase/docs` module graph, and another file doing the same
adds enough parallel transform load to time out an unrelated 5 s import
smoke test elsewhere in the suite. Adding a third editor-mounting file would
have been the natural move and would have risked a flake in a test nobody
would connect to this change. Read the comments at the top of a test file
before adding a sibling.

## Environment

`rtk` filters Bash output and mangled several `grep` runs (empty results,
truncated matches, a `no matches found` from zsh globbing `--include=*.ts`
unquoted). `node -e` with `fs.readFileSync` was the reliable way to read
source ranges and enumerate call sites. Quote glob arguments to `grep`.
