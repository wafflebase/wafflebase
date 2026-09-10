# Lessons — docs list level carries the subtree (#1050)

## What the flat model forces

`listLevel` is a plain integer on the block, so there is no parent pointer to
follow and no way to move "a subtree" as an object. Every writer has to
re-derive the subtree from adjacency at the moment of the gesture. That is why
the fix is a *planning* step rather than a new model field: compute the whole
`block → new level` map from the pre-edit array first, then write. Reading
levels back while writing them would make the second item of a subtree see the
first item's new level and mis-detect its own parent.

## Boundaries have to fail as a unit

The two clamps (`0` and `MAX_LIST_LEVEL`) were per-block before, which is
correct for a flat operation and wrong for a subtree one: clamping one member
of a subtree collapses the depth gap and reproduces exactly the bug being
fixed. Refusing the whole subtree keeps a single invariant ("relative depth is
preserved, or nothing moves") instead of two competing ones.

The pre-existing "Tab clamps at 8" test still passes unchanged, because a run
of *equal*-level items are siblings, not children — so per-item clamping and
per-subtree refusal agree whenever no nesting exists.

## Four call sites, one rule

The same six handlers duplicate this logic across `text-editor.ts`,
`editor.ts` and `text-box-editor.ts` (the last is what Slides and Board mount).
Threading `siblings` through each `forEachBlockInSelection` was the cheap part;
the value is that the rule itself now lives in one pure function with tests,
so the next list gesture added to any of the three editors inherits it.

## Not verified

The issue asked for the behavior to be confirmed by hand against Word and
Google Docs. This run is headless with no access to either, so the rule above
is a recorded decision derived from the model's constraints, not a measurement.

## Round-5 review findings

Six blocking findings. All six were verified against the code first; every one
was real, and four of them were reproduced as a failing test before being
fixed.

### `snapshot()` and the caret flush are not one thing

Moving `saveSnapshot()` inside `doc.batch()` looked like the established
pattern (`withNamedStyleChange`, `rewriteLinkHrefInPlace` both snapshot inside
a batch) — but those pass the plain `docStore.snapshot()`, and the docs
editor's `saveSnapshot` hook is *two* operations: the store checkpoint **and**
`setCursorForHistory`, which flushes the pre-edit caret and selection into
presence so Yorkie can reverse to them. `YorkieDocStore` deliberately drops a
non-history presence write while a batch is open (`skipNonHistoryPresence`),
so the flush never landed and undo after Tab / Cmd+] restored whatever the
throttled live cursor publish last sent — the #523 / #609 class of bug.

The two halves want opposite sides of the batch boundary: the checkpoint has
to be *inside* (`MemDocStore.snapshot()` is a no-op within a batch, which is
what keeps the gesture one undo unit — hoisting it out costs a second, dead
checkpoint), the caret flush has to be *before*. So `TextEditor` gained an
optional `recordCursorForHistory` hook, wired the way `requestCursorRender`
already is, and the three batched handlers call it ahead of `doc.batch()`.
`editor.ts`'s toolbar `indent`/`outdent` never flushed the caret at all, before
this branch or after, so that gap is pre-existing and left alone.

### A parent-map miss must not be guessed at

Both new `siblingsOf` copies fell back to the region's top-level array when
the layout-time parent map had no entry for the caret's block. That array does
not contain a cell block, so `planListLevelChanges` never found the selected
id and the *whole gesture* silently did nothing — worse than the pre-change
behavior, which at least moved the one block. And the `text-editor.ts` copy
resolved the parent table with throwing `getBlock`, so a table a peer removed
since the last layout threw out of the middle of a keydown handler.

Both are ordinary states, not corruption: the map is rebuilt only by the
layout pass. `Doc.findBlock` already keeps a full-walk fallback for exactly
this, so the fix is one model-level `Doc.siblingBlocksOf(blockId)` with the
same two-step resolution (parent map, then walk the tables), used by both
editors. That also removes the disagreement between the two copies rather
than aligning them by hand.

### Normalizing in the planner protects only the planner

`levelOf` made the planner's floor and ceiling total, but the other readers of
`listLevel` run *before* any gesture could repair a poisoned value — layout on
first render, the serializers on export — and they are the ones that crash:
`computeListCounters` does `levelCounters.length = level + 1`
(`RangeError: Invalid array length` on `NaN`) and the markdown serializer does
`'  '.repeat(level)` (`RangeError: Invalid string length` on `1e9`). Both were
reproduced as failing tests. A collaborator with write access could therefore
blank the rendered document, or the `--format md` export, for every other
reader.

Fixed by exporting `normalizeListLevel` and clamping at the two read
boundaries where a peer's value enters the model (`treeNodeToBlock`,
`YorkieDocStore`'s `parseBlock`) *and* at the raw sinks (layout ×2, markdown,
PDF painter ×2). The boundaries alone would do for the collaborative path; the
sinks are also reachable from documents built another way, and the clamp is
one call each.

### The headline behavior needed a test that can fail

`doc.batch()` was added so a subtree gesture is one undo unit — but
`MemDocStore` takes its undo units from `snapshot()`, so removing the batch
entirely changes nothing a level assertion can observe. A test that only
pressed `undo()` would have passed either way. The regression guard is a
`MemDocStore` subclass that records the open batch depth at each
`setBlockType` (and at each cursor flush, which is how the finding above is
guarded), paired with `canUndo() === false` after one undo — that last
assertion is what catches a checkpoint hoisted out of the batch.

### A new export has two entries, and only one lane sees the second

Exporting `normalizeListLevel` from `src/index.ts` was enough for every lane
that runs in this repo's unit gate, and enough for `verify:self`. It was not
enough for `verify-integration`: `YorkieDocStore` imports the symbol, and the
frontend `.integration.ts` suites run that store under Node, where
`package.json`'s `node` condition resolves `@wafflebase/docs` to the *built*
`dist/node.js` — a different entry, `src/node.ts`, which did not re-export it.
Both docs suites died at ESM link time with "does not provide an export named
`normalizeListLevel`" before a single assertion ran.

`test/store/entry-parity.test.ts` exists precisely to catch this and did not,
because it is an allowlist of source modules (`block-helpers.js`,
`types.js`) rather than a sweep — a symbol from a module nobody had listed is
invisible to it. Adding `list-level.js` to the list closes this instance;
the shape of the guard means the next new source module will need the same
line. A version that diffs *every* `export {...} from` clause the two entries
share would need no upkeep, and is the better fix if this recurs.

Worth knowing when reproducing locally: the frontend integration lane resolves
against built dists, so an unbuilt `slides`/`sheets` produces
`ERR_MODULE_NOT_FOUND` failures that look like regressions and are not. Build
the workspace packages first, or the signal is noise.

### Left undone

The 16 non-blocking suggestions and 4 nits are untouched, including the two
that were adjudicated "upheld" but filed as suggestions: `editor.ts`'s
same-cell branch still resolves parentage through the body-only
`layout.blockParentMap` (line 1683), and the slides PPTX export still
hard-codes its own list-level ceiling.

## Round-9 review findings

### A band has producers, not only readers

The hardening added `normalizeFontSize` / `isPaintableImageSize` /
`normalizeCellPadding` / `normalizeRowHeight` at the two CRDT *read*
boundaries and stopped there. But the model has other writers, and the paste
sanitizer is one: it validated the same four fields to "any finite number".
The result is worse than no band at all — the pasting client holds `1e9` and
renders it, while every peer, the same user after reload, the revision preview
and the PDF painter read it banded. A band that is not applied at every
producer converts a rendering glitch into two clients disagreeing about the
same document.

The rule to carry forward: when adding a band, enumerate the *writers* of the
field, not just the parsers. `grep` for the field name and read every hit that
assigns it.

### Clamping at the consumer desyncs the consumers

`paginatableRowHeight` was the tidy-looking fix: bound the height the row-split
loop consumes and leave the layout alone. It is wrong because a row height is a
*shared* number — `LayoutTable.rowHeights`, `rowYOffsets` and `totalHeight` are
read raw by the table renderer, the row hit-tests, the selection geometry and
the scroll extent — so clamping in one consumer makes that consumer the only
one with the clamped value. The equality "a table `PageLine`'s height ===
`rowHeights[row]`" was an unwritten contract out-of-diff code relies on.

Two rules came out of it. Substitute a value only where it *becomes* the thing
(here `computeTableLayout`, the one place a row height turns into geometry).
And when a loop needs bounding, bound the *loop* — count iterations — rather
than falsifying its input: `MAX_ROW_PAGE_SPAN` now caps fragments and lets the
last one take the remainder, so termination and the geometry contract are both
kept.

### "Boundaries apply as a unit" is right for carrying, wrong for selecting

The subtree rule refused a whole subtree when its root hit the floor, and
marked every member covered so a selected descendant could not move either.
That reads as principled and produced a plain regression: on any document
whose first list item is at level 0, that item's subtree covers everything
below it, so select-all + Shift+Tab did nothing at all — where before the
branch each selected item outdented and clamped at 0.

The distinction the rule was missing is *why* a block is in the plan. A child
that is merely carried moves only with its parent, so a parent that cannot
move keeps it. A child the user selected asked to move on its own account. So
refusal now suppresses only the refused item, and its members stay eligible as
subtree roots of their own. Worth noting the branch's own test asserted the
regression as intended behaviour — an assertion is not evidence that the
behaviour is right, only that it is deliberate.

### Two parsers, one test suite

`YorkieDocStore` is a hand-maintained duplicate of `crdt-tree.ts`, and it is
the copy that reads a collaborator's attributes in the live editor. Every band
was tested against the docs-package copy only, in a package that also has a
`tsc` lane; the frontend copy had neither. Nothing would have failed if a guard
there were wired to the wrong field, dropped, or inverted.

Testing it needed one non-obvious step: the writing store answers
`getDocument()` from the document it cached on write, so the poisoned values
have to be read back through a *second* store over the same Yorkie document —
which is what a peer is. Two smaller traps in the same test: `cloneDocument`
goes through JSON, so a dropped `rowHeights` entry arrives as `null` rather
than `undefined`, and a non-finite value written through `MemDocStore` arrives
as `null` too (which is why the paint-side test poisons with `1e9`).

### Verify a "never exercised" finding before writing the test

Two findings were about untested code paths, and neither test could be written
honestly as asked:

- The paginator's `if (!(fragHeight > 0)) fragHeight = remaining` floor is
  unreachable. `remaining` is `> 0` by the loop condition and neither branch
  above it can return a non-positive fragment. Proven by making the line throw
  and running the whole 2000-test suite — nothing hit it. So the comment now
  says it is a belt-and-braces guard rather than the thing that terminates the
  loop, and the test that was asked for asserts the *behaviour* (a degenerate
  `pageSetup` terminates and places every row once) instead of pretending to
  cover the line.
- The text-box editor's `doc.batch()` cannot be observed through its own
  store: `initializeTextBox` owns a `MemDocStore`, whose undo units come from
  `snapshot()`. Verified by removing the batch — the undo assertion still
  passed. The test kept the user-visible claim and records what it cannot see.

Same rule as round 5's "the headline behavior needed a test that can fail",
one step earlier: before writing a test for a finding, check that the code can
actually reach the state the test would assert.

### A dirty mark into a cache the target never uses

The round-9 correctness lens read `markDirty(cellInfo?.tableBlockId ?? id)` as
repainting a table at its old indent whenever `blockParentMap` misses. It
cannot: `computeLayout` recomputes every `table` block's layout *before* it
reaches the `canUseCache` branch, so a cell child repaints whether the map
resolves it or not. Rejected with that evidence, plus a test that deletes the
map entry and asserts the repaint. The lesson is about the code, not the
lens: a dirty mark whose target is never cached is dead bookkeeping that reads
as load-bearing, and it drew a reviewer's attention twice.
